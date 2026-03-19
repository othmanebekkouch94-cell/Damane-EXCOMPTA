const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

// ─── Constants ───────────────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2000;
const MAX_YEAR = CURRENT_YEAR + 1;
const MAX_INVOICE_AMOUNT = 5_000_000; // 5M€ max par facture - au-delà c'est une erreur
const MIN_INVOICE_AMOUNT = 0.01;

class ZipProcessor {
  constructor() {
    this.supportedExtensions = ['.pdf', '.xlsx', '.xls', '.csv'];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT
  // ═══════════════════════════════════════════════════════════════════════════
  async processZip(zipPath, onProgress = () => {}) {
    const startTime = Date.now();
    const report = {
      summary: { totalFiles: 0, processedFiles: 0, invoicesFound: 0, errors: 0, totalHT: 0, totalTVA: 0, totalTTC: 0 },
      invoices: [],
      errors: [],
      bySupplier: {},
      byMonth: {},
      byYear: {},
      amountDistribution: { '<100': 0, '100-500': 0, '500-1000': 0, '1000-5000': 0, '5000-10000': 0, '>10000': 0 },
      duplicates: [],
      timeline: [],
    };

    try {
      onProgress(5, 'Ouverture du fichier ZIP...');
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      const supportedFiles = entries.filter(e => {
        if (e.isDirectory) return false;
        const ext = path.extname(e.entryName).toLowerCase();
        return this.supportedExtensions.includes(ext);
      });

      report.summary.totalFiles = supportedFiles.length;
      onProgress(10, `${supportedFiles.length} fichiers détectés`);

      for (let i = 0; i < supportedFiles.length; i++) {
        const entry = supportedFiles[i];
        const progress = 10 + Math.round((i / supportedFiles.length) * 82);
        onProgress(progress, `[${i + 1}/${supportedFiles.length}] ${path.basename(entry.entryName)}`);

        try {
          // Le dossier parent dans le ZIP = le fournisseur
          const folderSupplier = this.extractFolderSupplier(entry.entryName);
          const result = await this.processEntry(entry, folderSupplier);
          report.summary.processedFiles++;

          if (result && result.isInvoice && result.totalAmount >= MIN_INVOICE_AMOUNT) {
            report.summary.invoicesFound++;
            report.invoices.push(result);

            // Totaux
            report.summary.totalHT += result.totalHT || 0;
            report.summary.totalTVA += result.totalTVA || 0;
            report.summary.totalTTC += result.totalTTC || result.totalAmount || 0;

            // Par fournisseur
            const supplier = result.supplier || 'Non identifié';
            if (!report.bySupplier[supplier]) report.bySupplier[supplier] = { count: 0, total: 0, invoices: [] };
            report.bySupplier[supplier].count++;
            report.bySupplier[supplier].total += result.totalTTC || result.totalAmount;
            report.bySupplier[supplier].invoices.push(result.invoiceNumber || result.fileName);

            // Par mois/année
            if (result.date) {
              const d = this.parseDate(result.date);
              if (d) {
                const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const yearKey = `${d.getFullYear()}`;
                if (!report.byMonth[monthKey]) report.byMonth[monthKey] = { count: 0, total: 0 };
                report.byMonth[monthKey].count++;
                report.byMonth[monthKey].total += result.totalTTC || result.totalAmount;
                if (!report.byYear[yearKey]) report.byYear[yearKey] = { count: 0, total: 0 };
                report.byYear[yearKey].count++;
                report.byYear[yearKey].total += result.totalTTC || result.totalAmount;
              }
            }

            // Distribution
            const amt = result.totalTTC || result.totalAmount;
            if (amt < 100) report.amountDistribution['<100']++;
            else if (amt < 500) report.amountDistribution['100-500']++;
            else if (amt < 1000) report.amountDistribution['500-1000']++;
            else if (amt < 5000) report.amountDistribution['1000-5000']++;
            else if (amt < 10000) report.amountDistribution['5000-10000']++;
            else report.amountDistribution['>10000']++;
          }
        } catch (err) {
          report.summary.errors++;
          report.errors.push({ file: entry.entryName, error: err.message });
        }
      }

      // Normaliser les fournisseurs (fusionner les variantes)
      onProgress(92, 'Normalisation des fournisseurs...');
      this.normalizeSuppliers(report);

      onProgress(94, 'Détection des doublons...');
      report.duplicates = this.detectDuplicates(report.invoices);

      // Contrôle comptable automatique
      onProgress(96, 'Contrôle comptable...');
      report.controles = this.runAccountingControls(report.invoices);

      // Tri par date décroissante
      report.invoices.sort((a, b) => {
        const da = a.date ? this.parseDate(a.date) : null;
        const db = b.date ? this.parseDate(b.date) : null;
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db - da;
      });

      report.timeline = Object.entries(report.byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({ month, ...data }));

      report.summary.processingTime = Date.now() - startTime;
      onProgress(100, 'Traitement terminé');
    } catch (err) {
      report.errors.push({ file: 'ZIP', error: err.message });
    }

    return report;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT FOLDER NAME AS SUPPLIER
  // ═══════════════════════════════════════════════════════════════════════════
  extractFolderSupplier(entryName) {
    // entryName = "FACTURES 2025/AMAZON/facture_123.pdf"
    // On veut le dossier le plus proche du fichier (dernier dossier parent)
    const parts = entryName.replace(/\\/g, '/').split('/').filter(p => p.length > 0);
    if (parts.length < 2) return null; // fichier à la racine du ZIP

    // Le dossier parent direct du fichier
    const parentFolder = parts[parts.length - 2];

    // Ignorer les dossiers génériques (racine du ZIP)
    const genericFolders = /^(factures?|invoices?|documents?|uploads?|files?|data|zip|archive|\d{4}|factures?\s*\d{4})/i;
    if (genericFolders.test(parentFolder.trim())) {
      // Si le parent est générique, essayer le grand-parent
      if (parts.length >= 3) {
        const grandParent = parts[parts.length - 3];
        if (!genericFolders.test(grandParent.trim())) {
          return grandParent.trim();
        }
      }
      return null; // Pas de fournisseur identifiable par dossier
    }

    return parentFolder.trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCESS ONE ENTRY
  // ═══════════════════════════════════════════════════════════════════════════
  async processEntry(entry, folderSupplier) {
    const ext = path.extname(entry.entryName).toLowerCase();
    const buffer = entry.getData();
    const fileName = path.basename(entry.entryName);
    let text = '';

    if (ext === '.pdf') {
      try {
        const pdfResult = await pdfParse(buffer);
        text = pdfResult.text;
      } catch (e) {
        return { isInvoice: false, fileName, error: e.message };
      }
    } else if (['.xlsx', '.xls'].includes(ext)) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const rows = [];
      for (const name of workbook.SheetNames) {
        rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' }));
      }
      text = rows.map(r => Object.values(r).join(' | ')).join('\n');
    } else if (ext === '.csv') {
      text = buffer.toString('utf-8');
    }

    if (!text || text.trim().length < 20) {
      return { isInvoice: false, fileName };
    }

    const result = this.extractInvoiceData(text, fileName);

    // PRIORITÉ ABSOLUE : le nom du dossier = le fournisseur
    if (folderSupplier) {
      result.supplier = folderSupplier;
    }

    // Stocker le chemin complet et le buffer pour permettre la visualisation
    result.filePath = entry.entryName.replace(/\\/g, '/');
    result.fileSize = entry.header.size;

    // Date de modification du fichier (métadonnée ZIP)
    try {
      const header = entry.header;
      if (header.time) {
        result.fileModifiedDate = new Date(header.time).toLocaleDateString('fr-FR');
        result.fileModifiedISO = new Date(header.time).toISOString();
      }
    } catch (e) { /* ignore */ }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT INVOICE DATA — PRECISION CHIRURGICALE
  // ═══════════════════════════════════════════════════════════════════════════
  extractInvoiceData(text, fileName) {
    const result = {
      isInvoice: false,
      confidence: 0,
      fileName,
      invoiceNumber: null,
      date: null,
      dueDate: null,
      supplier: null,
      description: null, // Libellé/description de la facture
      totalHT: 0,
      totalTVA: 0,
      totalTTC: 0,
      totalAmount: 0,
      tvaRate: null,
      currency: 'EUR',
      paymentMethod: null,
      siret: null,
    };

    // ── 1. Normalisation du texte ─────────────────────────────────────────
    // Supprimer les zéros parasites qui génèrent des montants aberrants
    const textClean = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    const textLower = textClean.toLowerCase();

    // ── 2. Détection "est-ce une facture ?" ───────────────────────────────
    let confidence = 0;
    const invoiceTerms = ['facture', 'invoice', 'total ttc', 'total ht', 'net à payer', 'net a payer', 'amount due', 'montant ttc', 'montant ht'];
    for (const t of invoiceTerms) {
      if (textLower.includes(t)) confidence += 15;
    }
    // Bonus si le nom de fichier contient un terme de facture
    const fnLower = fileName.toLowerCase();
    const fnTerms = ['facture', 'fact', 'fac', 'invoice', 'avoir', 'fa-', 'fv-'];
    for (const t of fnTerms) {
      if (fnLower.includes(t)) { confidence += 20; break; }
    }

    result.isInvoice = confidence >= 20;
    result.confidence = Math.min(confidence, 100);

    if (!result.isInvoice) return result;

    // ── 3. Extraction des montants (PRÉCISION MAXIMUM) ────────────────────
    const amounts = this.extractAmounts(textClean, fileName);
    result.totalHT = amounts.ht;
    result.totalTVA = amounts.tva;
    result.totalTTC = amounts.ttc;
    result.tvaRate = amounts.tvaRate;
    result.totalAmount = amounts.ttc || amounts.ht || 0;

    // Validation : si montant absurde → facture invalide
    if (result.totalAmount > MAX_INVOICE_AMOUNT) {
      result.isInvoice = false;
      result.confidence = 0;
      return result;
    }

    // ── 4. Extraction du numéro de facture ────────────────────────────────
    result.invoiceNumber = this.extractInvoiceNumber(textClean, fileName);

    // ── 5. Extraction des dates (avec validation d'année) ─────────────────
    const dates = this.extractDates(textClean);
    result.date = dates.invoiceDate;
    result.dueDate = dates.dueDate;

    // ── 6. Extraction du fournisseur (INTELLIGENT) ────────────────────────
    result.supplier = this.extractSupplier(textClean, fileName);

    // ── 7. Extraction SIRET ───────────────────────────────────────────────
    const siretMatch = textClean.match(/(?:siret|siren)\s*[:\-]?\s*(\d{9}|\d{14}|\d{3}\s?\d{3}\s?\d{3}\s?\d{5})/i);
    if (siretMatch) result.siret = siretMatch[1].replace(/\s/g, '');

    // ── 8. Devise ─────────────────────────────────────────────────────────
    if (textLower.match(/\b(mad|dirham|dh)\b/)) result.currency = 'MAD';
    else if (textLower.match(/\busd\b|\$\s*\d/)) result.currency = 'USD';
    else if (textLower.match(/\bgbp\b|£\s*\d/)) result.currency = 'GBP';

    // ── 9. Mode de paiement ───────────────────────────────────────────────
    if (textLower.match(/\bvirement\b|\bwire\b|\biban\b/)) result.paymentMethod = 'Virement';
    else if (textLower.match(/\bchèque\b|\bcheque\b/)) result.paymentMethod = 'Chèque';
    else if (textLower.match(/\bcarte\b|\bcard\b|\bcb\b/)) result.paymentMethod = 'Carte';
    else if (textLower.match(/\bprélèvement\b|\bsepa\b/)) result.paymentMethod = 'Prélèvement';

    // ── 10. Extraction description / libellé ────────────────────────────
    result.description = this.extractDescription(textClean, fileName);

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACTION DES MONTANTS — AVEC VALIDATION STRICTE
  // ═══════════════════════════════════════════════════════════════════════════
  extractAmounts(text, fileName) {
    const result = { ht: 0, tva: 0, ttc: 0, tvaRate: null };

    // ══════════════════════════════════════════════════════════════════════════
    // PRIORITÉ 1 : MONTANT DANS LE NOM DU FICHIER (source la plus fiable)
    // Exemples réels :
    //   "BRUNEAU Fact 25-581-148 du 10 01 2025 pour 479.11 €"
    //   "ARK DIGITAL FACT FA-0083 25 DU 25 08 2025 POUR 5160€.pdf"
    //   "AMAZON FAC FR50003 du 24 02 25 de 8.32€.pdf"
    //   "MEDJOR FAC FV24E00040 DU    DE 110 952€"        ← espace dans montant
    //   "facture MEDJOOL STAR FV24E00065 montant 86944€00" ← €00 = centimes
    //   "MEDJOOL STAR Fac FV24E00065 du 06 02 25 de  86 944 €00"
    //   "CARREFOUR DISTRIB du 05 03 2025 de 64€74"        ← €74 = centimes
    // ══════════════════════════════════════════════════════════════════════════
    const fnClean = (fileName || '').replace(/\.[a-z]+$/i, ''); // retirer extension
    const fnAmountPatterns = [
      // "pour 479.11 €" / "de 8.32€" / "DE 110 952€" / "montant 86944€00"
      /(?:pour|de|montant|=)\s*([\d\s.,]+)\s*€\s*(\d{0,2})/i,
      // "132 512.00€" / "5160€" / "64€74" / "86 944 €00"
      /([\d\s.,]+)\s*€\s*(\d{0,2})/i,
    ];
    for (const pat of fnAmountPatterns) {
      const m = fnClean.match(pat);
      if (m) {
        let amountStr = m[1].trim();
        const centimes = m[2] ? m[2].trim() : '';
        // Si centimes après € (ex: "86944€00" → "86944.00", "64€74" → "64.74")
        if (centimes.length > 0) {
          amountStr = amountStr + '.' + centimes;
        }
        const v = this._parseAmount(amountStr);
        if (v >= 0.01 && v <= 5000000) {
          result.ttc = v;
          // Le nom de fichier donne le TTC — on ne cherche PAS dans le contenu PDF
          // pour éviter les montants aberrants. On cherche juste le taux TVA.
          const tvaRateMatch = text.match(/tva\s+(?:[àa]\s+)?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
          if (tvaRateMatch) {
            const rate = parseFloat(tvaRateMatch[1].replace(',', '.'));
            if (rate > 0 && rate <= 25) {
              result.tvaRate = rate;
              result.ht = Math.round((v / (1 + rate / 100)) * 100) / 100;
              result.tva = Math.round((v - result.ht) * 100) / 100;
            }
          }
          return result; // STOP — ne pas chercher dans le PDF
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIORITÉ 2 : MONTANT DANS LE CONTENU PDF (si pas trouvé dans le nom)
    // ══════════════════════════════════════════════════════════════════════════

    // Normaliser les séparateurs de milliers et décimaux
    // Le texte peut contenir : 1.234,56 / 1 234,56 / 1234.56 / 1234,56
    const parseNum = (str) => {
      if (!str) return 0;
      str = str.trim();

      // Supprimer les espaces insécables et espaces ordinaires comme séparateurs de milliers
      // Format européen : 1 234,56 ou 1.234,56
      // Format anglais : 1,234.56
      let cleaned = str.replace(/\s/g, '');

      // Si la chaîne a plus d'un séparateur décimal potentiel, c'est un millier
      if (cleaned.includes(',') && cleaned.includes('.')) {
        // Identifier lequel est décimal (dernier) vs millier (premier)
        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');
        if (lastComma > lastDot) {
          // Format européen : 1.234,56 → 1234.56
          cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
          // Format anglais : 1,234.56 → 1234.56
          cleaned = cleaned.replace(/,/g, '');
        }
      } else if (cleaned.includes(',')) {
        // Vérifier si c'est un décimal ou un millier
        const parts = cleaned.split(',');
        if (parts.length === 2 && parts[1].length <= 2) {
          // Décimal : 1234,56 → 1234.56
          cleaned = cleaned.replace(',', '.');
        } else {
          // Millier : 1,234 → 1234
          cleaned = cleaned.replace(/,/g, '');
        }
      }
      // Si seulement un point, vérifier si c'est millier ou décimal
      else if (cleaned.includes('.')) {
        const parts = cleaned.split('.');
        if (parts.length === 2 && parts[1].length <= 2) {
          // Décimal : 1234.56
          // pas de changement
        } else {
          // Millier ou plusieurs points: 1.234.567
          // Garder le dernier point comme décimal si <= 2 chiffres après
          const lastDotParts = cleaned.split('.');
          const lastPart = lastDotParts[lastDotParts.length - 1];
          if (lastPart.length <= 2) {
            // Dernier point = décimal
            cleaned = cleaned.replace(/\./g, (m, offset) => offset === cleaned.lastIndexOf('.') ? '.' : '');
          } else {
            cleaned = cleaned.replace(/\./g, '');
          }
        }
      }

      const num = parseFloat(cleaned);
      if (isNaN(num) || num < 0 || num > MAX_INVOICE_AMOUNT) return 0;
      return Math.round(num * 100) / 100;
    };

    // ── Patterns TTC ─────────────────────────────────────────────────────────
    // IMPORTANT: on utilise [\d.,] sans \s pour éviter de capturer des séquences
    // de chiffres séparés par des espaces qui ne sont PAS un montant.
    // On gère les espaces milliers (max 2 espaces dans un montant < 10M)
    // Pattern strict : montant avec séparateurs milliers (espace, point ou virgule)
    // Max 999 999,99 — pas de capture de séquences parasites
    const AMT = '(\\d{1,3}(?:[\\s.,]\\d{3})*(?:[.,]\\d{1,2})?)';
    const ttcPatterns = [
      new RegExp(`(?:net\\s+[àa]\\s+payer|total\\s+ttc|montant\\s+ttc|total\\s+[àa]\\s+r[eé]gler|amount\\s+due|total\\s+due|solde\\s+[àa]\\s+payer)\\s*[:\\-]?\\s*${AMT}\\s*(?:€|EUR)?`, 'gi'),
    ];
    for (const pat of ttcPatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const v = parseNum(m[1]);
        if (v >= MIN_INVOICE_AMOUNT && v <= MAX_INVOICE_AMOUNT) { result.ttc = v; break; }
      }
    }

    // ── Patterns HT ──────────────────────────────────────────────────────────
    const htPatterns = [
      new RegExp(`(?:total\\s+ht|montant\\s+ht|sous[\\s-]+total\\s+ht|base\\s+ht|net\\s+commercial|total\\s+hors\\s+taxes?|subtotal)\\s*[:\\-]?\\s*${AMT}\\s*(?:€|EUR)?`, 'gi'),
    ];
    for (const pat of htPatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const v = parseNum(m[1]);
        if (v >= MIN_INVOICE_AMOUNT && v <= MAX_INVOICE_AMOUNT) { result.ht = v; break; }
      }
    }

    // ── Taux TVA ─────────────────────────────────────────────────────────────
    const tvaRateMatch = text.match(/tva\s+(?:[àa]\s+)?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
    if (tvaRateMatch) {
      const rate = parseFloat(tvaRateMatch[1].replace(',', '.'));
      if ([5.5, 10, 20, 8.5, 2.1, 0].includes(rate) || (rate > 0 && rate <= 25)) {
        result.tvaRate = rate;
      }
    }

    // ── Montant TVA ───────────────────────────────────────────────────────────
    const tvaAmtPatterns = [
      new RegExp(`(?:total\\s+tva|montant\\s+tva|tva\\s+(?:\\d+%?\\s+)?(?:[:\\-]))\\s*${AMT}\\s*(?:€|EUR)?`, 'gi'),
    ];
    for (const pat of tvaAmtPatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const v = parseNum(m[1]);
        // La TVA ne peut pas dépasser le montant HT
        if (v >= 0 && v < (result.ht || MAX_INVOICE_AMOUNT)) { result.tva = v; break; }
      }
    }

    // ── Validation croisée : TTC ne peut pas être > 1.25 × HT (TVA max 25%) ──
    if (result.ttc > 0 && result.ht > 0) {
      if (result.ttc > result.ht * 1.3) {
        // Le TTC est incohérent avec le HT → recalculer depuis HT
        if (result.tvaRate) {
          result.ttc = Math.round(result.ht * (1 + result.tvaRate / 100) * 100) / 100;
          result.tva = Math.round((result.ttc - result.ht) * 100) / 100;
        } else {
          // Supposer TVA 20% par défaut
          result.ttc = Math.round(result.ht * 1.2 * 100) / 100;
          result.tva = Math.round((result.ttc - result.ht) * 100) / 100;
          result.tvaRate = 20;
        }
      }
    }

    // ── Déductions croisées ───────────────────────────────────────────────────
    if (result.ttc && result.ht && !result.tva) {
      const diff = Math.round((result.ttc - result.ht) * 100) / 100;
      if (diff > 0 && diff < result.ttc) result.tva = diff;
    }
    if (result.ht && result.tva && !result.ttc) {
      result.ttc = Math.round((result.ht + result.tva) * 100) / 100;
    }
    if (result.ttc && !result.ht && result.tvaRate) {
      result.ht = Math.round((result.ttc / (1 + result.tvaRate / 100)) * 100) / 100;
      result.tva = Math.round((result.ttc - result.ht) * 100) / 100;
    }

    // ── Fallback 1 : montant avec symbole € obligatoire ─────────────────────
    if (!result.ttc && !result.ht) {
      // UNIQUEMENT si le montant est suivi de € ou EUR — pas de montant "libre"
      const fallbackMatch = text.match(new RegExp(`(?:total|montant|net\\s+[àa]\\s+payer)\\s*[:\\-]?\\s*${AMT}\\s*(?:€|EUR)`, 'i'));
      if (fallbackMatch) {
        const v = parseNum(fallbackMatch[1]);
        if (v >= MIN_INVOICE_AMOUNT && v <= MAX_INVOICE_AMOUNT) result.ttc = v;
      }
    }

    return result;
  }

  // Parse un montant depuis une chaîne (version simple pour noms de fichiers)
  _parseAmount(str) {
    if (!str) return 0;
    let cleaned = str.trim().replace(/\s/g, '');
    // Format européen : 1.234,56 → 1234.56
    if (cleaned.includes(',') && cleaned.includes('.')) {
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes(',')) {
      const parts = cleaned.split(',');
      if (parts.length === 2 && parts[1].length <= 2) {
        cleaned = cleaned.replace(',', '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    }
    const num = parseFloat(cleaned);
    return isNaN(num) || num < 0 ? 0 : Math.round(num * 100) / 100;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACTION DU NUMÉRO DE FACTURE — MULTI-SOURCE
  // ═══════════════════════════════════════════════════════════════════════════
  extractInvoiceNumber(text, fileName) {
    // ── SOURCE 1 : NOM DU FICHIER (très fiable pour les noms structurés) ─────
    // Exemples réels :
    //   "AMAZON FAC FR50003OTVEZ31 du 24 02 25 de 8.32€.pdf"
    //   "ARK DIGITAL FACT FA-0083 25 DU 25 08 2025 POUR 5160€.pdf"
    //   "UNILEVER APL FACT 3900616651 DU 17 02 2026 POUR 48672.00€.PDF"
    //   "facture N°FR5001NVT21Z1l - AMAZON.pdf"
    //   "Facture AMUNDI 2025.pdf"
    //   "ASNIERES AFFAIRES FAC ASN0008446_2025.01.01 DE 144€.pdf"
    const fnClean = (fileName || '').replace(/\.[a-z]+$/i, ''); // enlever extension

    const fnPatterns = [
      // "FACT FA-0083" / "FAC FR50003OTVEZ31" / "FACT 3900616651"
      /(?:FACT|FAC|FA|FV|INV)\s*\.?\s*(?:N[°o.]?\s*)?([A-Z0-9][A-Z0-9\-_\/\.]{2,30})/i,
      // "facture N°FR5001NVT21Z1l"
      /(?:facture|invoice)\s*N[°o.]?\s*([A-Z0-9][A-Z0-9\-_\/\.]{2,30})/i,
      // "fac_20250211R675109" (underscore separator)
      /(?:fac|fact|fa|fv)[_\-]([A-Z0-9][A-Z0-9\-_]{4,30})/i,
      // "ASN0008446" "F_00700226"  (code alphanumérique 6+ chars)
      /\b([A-Z]{1,4}[\-_]?\d{4,12})\b/i,
      // "F202601037053" (F suivi de chiffres)
      /\b(F\d{6,15})\b/i,
    ];

    for (const pat of fnPatterns) {
      const m = fnClean.match(pat);
      if (m) {
        const num = m[1].trim();
        // Valider : pas une date, pas un montant, pas un mot courant
        if (this.isValidInvoiceNumber(num)) return num;
      }
    }

    // ── SOURCE 2 : CONTENU DU PDF (patterns contextuels) ─────────────────────
    const textPatterns = [
      // "Facture n° FA-2025-001" / "Invoice No. INV-123"
      /(?:facture|invoice|fact\.?|avoir)\s*(?:n[°o.\s]*|num[eé]ro\s*(?:de\s*)?)?[:\-]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/gi,
      // "N° de facture : FA-123" / "N° : 123456"
      /(?:n[°o.]\s*(?:de\s+)?(?:facture|fact|document))\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/gi,
      // "Référence : REF-2025-001"
      /(?:r[eé]f[eé]rence|ref\.?)\s*(?:facture\s*)?[:\-]\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/gi,
      // "Document : DOC-123"
      /(?:document|doc\.?)\s*(?:n[°o.]?\s*)?[:\-]\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/gi,
      // "Votre commande n° 123-456"
      /(?:commande|order)\s*(?:n[°o.]?\s*)?[:\-]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/gi,
      // Numéro seul après "N°" : "N° 20250001234"
      /\bN[°o]\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/_.]{4,25})/gi,
    ];

    for (const pat of textPatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const num = m[1].trim();
        if (this.isValidInvoiceNumber(num)) return num;
      }
    }

    // ── SOURCE 3 : Pattern alphanumérique autonome dans le texte ──────────────
    // Chercher un code qui ressemble à un numéro de facture (ex: "FR50003OTVEZ31")
    const autonomePatterns = [
      /\b([A-Z]{2,4}\d{5,15}[A-Z0-9]*)\b/g,  // "FR50003OTVEZ31", "FA00834"
      /\b(\d{8,15})\b/g,                        // "3900616651" (numéro long)
    ];

    for (const pat of autonomePatterns) {
      pat.lastIndex = 0;
      // Chercher dans les 3000 premiers chars (zone typique du numéro)
      const header = text.substring(0, 3000);
      const m = pat.exec(header);
      if (m) {
        const num = m[1].trim();
        // Exclure les IBAN, SIRET, numéros de téléphone
        if (this.isValidInvoiceNumber(num) && !num.match(/^(FR\d{2}\s?\d{4})/) && num.length <= 20) {
          return num;
        }
      }
    }

    return null;
  }

  /**
   * Valide qu'une chaîne ressemble à un numéro de facture et pas autre chose
   */
  isValidInvoiceNumber(num) {
    if (!num || num.length < 3 || num.length > 35) return false;
    // Rejeter les mots courants
    if (num.match(/^(date|page|euro|total|ht|ttc|tva|net|pour|montant|siret|siren|iban|bic|swift|code|tel|fax|mail)/i)) return false;
    // Rejeter les pures dates (01/02/2025 ou 20250201)
    if (num.match(/^\d{2}[\/.\-]\d{2}[\/.\-]\d{2,4}$/)) return false;
    // Rejeter les montants (1234.56€)
    if (num.match(/^\d+[.,]\d{2}$/)) return false;
    // Rejeter les codes postaux seuls
    if (num.match(/^\d{5}$/)) return false;
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACTION DES DATES — AVEC VALIDATION STRICTE
  // ═══════════════════════════════════════════════════════════════════════════
  extractDates(text) {
    const result = { invoiceDate: null, dueDate: null };

    // Pattern de date valide (DD/MM/YYYY ou DD.MM.YYYY ou DD-MM-YYYY)
    const dateRegex = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/g;

    const validateDate = (day, month, year) => {
      let y = parseInt(year);
      if (y < 100) y += 2000;
      const m = parseInt(month);
      const d = parseInt(day);
      if (y < MIN_YEAR || y > MAX_YEAR) return null;
      if (m < 1 || m > 12) return null;
      if (d < 1 || d > 31) return null;
      return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
    };

    // Chercher la date de facture en contexte
    const invoiceDatePatterns = [
      /(?:date\s+(?:de\s+)?(?:facture|facturation|[eé]mission))\s*[:\-]?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/gi,
      /(?:le)\s+(\d{1,2})\s+(\w+)\s+(\d{4})/gi, // "le 15 janvier 2025"
      /(?:date)\s*[:\-]\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/gi,
    ];

    for (const pat of invoiceDatePatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const validated = validateDate(m[1], m[2], m[3]);
        if (validated) { result.invoiceDate = validated; break; }
      }
    }

    // Chercher la date d'échéance en contexte
    const dueDatePatterns = [
      /(?:[eé]ch[eé]ance|due\s+date|date\s+limite|r[eè]glement)\s*[:\-]?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/gi,
    ];
    for (const pat of dueDatePatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const validated = validateDate(m[1], m[2], m[3]);
        if (validated) { result.dueDate = validated; break; }
      }
    }

    // Fallback : prendre la première date valide du document
    if (!result.invoiceDate) {
      let m;
      dateRegex.lastIndex = 0;
      while ((m = dateRegex.exec(text)) !== null) {
        const validated = validateDate(m[1], m[2], m[3]);
        if (validated) {
          result.invoiceDate = validated;
          break;
        }
      }
    }

    // Chercher dates en lettres : "15 janvier 2025", "1er mars 2024"
    if (!result.invoiceDate) {
      const months = { janvier:1,février:2,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,août:8,aout:8,septembre:9,octobre:10,novembre:11,décembre:12,decembre:12 };
      const litMatch = text.match(/(\d{1,2})(?:er|ème)?\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(\d{4})/i);
      if (litMatch) {
        const y = parseInt(litMatch[3]);
        if (y >= MIN_YEAR && y <= MAX_YEAR) {
          const m = months[litMatch[2].toLowerCase()];
          result.invoiceDate = `${String(parseInt(litMatch[1])).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
        }
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACTION DU FOURNISSEUR — INTELLIGENT
  // ═══════════════════════════════════════════════════════════════════════════
  extractSupplier(text, fileName) {
    // ── Patterns contextuels (précision max) ─────────────────────────────────
    const contextPatterns = [
      /(?:de\s*[:]\s*|[eé]metteur\s*[:]\s*|vendeur\s*[:]\s*|prestataire\s*[:]\s*|fournisseur\s*[:]\s*)([^\n]{3,60})/gi,
      /(?:soci[eé]t[eé]|entreprise|raison\s+sociale)\s*[:\-]?\s*([^\n]{3,60})/gi,
      /(?:nous\s+sommes\s*[:]\s*|factur[eé]\s+par\s*[:]\s*)([^\n]{3,60})/gi,
    ];

    for (const pat of contextPatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const name = this.cleanSupplierName(m[1]);
        if (name) return name;
      }
    }

    // ── Détection de marques connues dans le texte ────────────────────────────
    const knownBrands = [
      'Amazon', 'Apple', 'Google', 'Microsoft', 'Orange', 'SFR', 'Bouygues',
      'EDF', 'Engie', 'Veolia', 'SNCF', 'Air France', 'Renault', 'Peugeot',
      'Total', 'TotalEnergies', 'BNP Paribas', 'Société Générale', 'Crédit Agricole',
      'Amundi', 'Axa', 'Allianz', 'Maif', 'Maaf', 'Free', 'La Poste', 'DHL', 'FedEx',
      'Chronopost', 'Darty', 'Fnac', 'Carrefour', 'Leclerc', 'Auchan',
    ];
    for (const brand of knownBrands) {
      if (text.toLowerCase().includes(brand.toLowerCase())) return brand;
    }

    // ── Heuristique : chercher une ligne qui ressemble à un nom de société ────
    // (sur les 20 premières lignes, car le nom est généralement en haut)
    const lines = text.split('\n')
      .slice(0, 25)
      .map(l => l.trim())
      .filter(l => l.length > 2 && l.length < 70);

    for (const line of lines) {
      // Ignorer les lignes qui sont manifestement autre chose
      if (line.match(/^(facture|invoice|date|ref|n°|tel|fax|email|www\.|http|page|iban|bic|swift|\d+)/i)) continue;
      if (line.match(/^(total|sous-total|montant|tva|ht|ttc)/i)) continue;
      if (line.match(/^\d[\d\s,./€-]*$/)) continue; // ligne de chiffres
      if (line.match(/^[A-Z]{2}\d{2}/)) continue; // IBAN
      if (line.split(' ').length > 8) continue; // phrase trop longue

      const name = this.cleanSupplierName(line);
      if (name && name.length >= 3) return name;
    }

    // ── Dernier recours : nom du fichier ─────────────────────────────────────
    const fnName = fileName
      .replace(/\.[a-z]+$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+\d{4,}\s*/g, ' ')
      .trim();
    if (fnName.length > 3 && fnName.length < 50) return fnName;

    return 'Non identifié';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACTION DESCRIPTION / LIBELLÉ — Résumer de quoi traite la facture
  // ═══════════════════════════════════════════════════════════════════════════
  extractDescription(text, fileName) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);

    // ── 1. Chercher un objet/description explicite ───────────────────────
    const descPatterns = [
      /(?:objet|description|d[eé]signation|libell[eé]|prestation|nature|article)\s*[:\-]\s*(.{5,120})/gi,
      /(?:concerne|pour)\s*[:\-]\s*(.{5,120})/gi,
    ];
    for (const pat of descPatterns) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        const desc = m[1].trim().replace(/\s{2,}/g, ' ');
        if (desc.length >= 5 && desc.length <= 120 && !desc.match(/^\d+[.,]\d{2}$/)) {
          return desc;
        }
      }
    }

    // ── 2. Chercher les lignes d'articles (tableau de la facture) ────────
    // Une ligne d'article contient souvent un texte + un montant
    const articleLines = [];
    for (const line of lines) {
      // Ignorer les en-têtes et lignes techniques
      if (line.match(/^(facture|invoice|date|ref|n°|tel|fax|email|total|sous.?total|montant|tva|ht|ttc|iban|bic|siret|siren|page|\d{2}[\/.-]\d{2})/i)) continue;
      if (line.match(/^\d+[.,]\d{2}\s*€?$/)) continue; // juste un montant
      if (line.length < 5 || line.length > 100) continue;

      // Si la ligne contient du texte + un nombre → c'est probablement un article
      const hasText = line.match(/[a-zA-ZÀ-ÿ]{3,}/);
      const hasNumber = line.match(/\d+[.,]\d{2}/);
      if (hasText && hasNumber) {
        // Extraire juste la partie texte (avant les nombres)
        const textPart = line.replace(/[\d\s.,€]+$/g, '').trim();
        if (textPart.length >= 4 && textPart.length <= 80) {
          articleLines.push(textPart);
        }
      }
    }

    if (articleLines.length > 0) {
      // Prendre les 3 premiers articles max
      const desc = articleLines.slice(0, 3).join(' | ');
      return desc.substring(0, 150);
    }

    // ── 3. Déduire depuis le nom du fichier ──────────────────────────────
    // Ex: "BRUNEAU Fact 25-581-148 du 10 01 2025 pour 479.11€" → "Fournitures BRUNEAU"
    const fnClean = (fileName || '')
      .replace(/\.[a-z]+$/i, '')           // extension
      .replace(/\b(fact|fac|fv|fa|inv)\b[.\s-]*/gi, '')  // mots facture
      .replace(/\b\d{2}[\s\/.-]\d{2}[\s\/.-]\d{2,4}\b/g, '') // dates
      .replace(/\b(du|de|pour|montant|le)\b/gi, '')      // mots vides
      .replace(/[\d.,]+\s*€?\s*$/g, '')    // montant final
      .replace(/[-_]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (fnClean.length >= 3 && fnClean.length <= 80) {
      return `Facture ${fnClean}`;
    }

    return null;
  }

  cleanSupplierName(str) {
    if (!str) return null;
    let name = str.trim()
      .replace(/[;|\\]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Supprimer les lignes qui contiennent des montants ou des codes techniques
    if (name.match(/\d{4,}/)) return null; // contient un long nombre
    if (name.match(/[€$£]/)) return null; // contient un symbole monétaire
    if (name.match(/^(bonjour|madame|monsieur|objet|re:|fw:)/i)) return null;
    if (name.length < 2 || name.length > 65) return null;
    return name;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DÉTECTION DES DOUBLONS — VÉRIFICATION CONTENU RÉEL
  // ═══════════════════════════════════════════════════════════════════════════
  detectDuplicates(invoices) {
    const duplicates = [];
    const seen = {};

    for (const inv of invoices) {
      if (!inv.invoiceNumber) continue;
      const amount = Math.round((inv.totalTTC || inv.totalAmount || 0) * 100) / 100;
      if (amount < MIN_INVOICE_AMOUNT) continue;

      // Le numéro de facture ne doit PAS être le nom du fournisseur
      // Si le numéro ressemble au fournisseur → skip (faux numéro)
      const numClean = (inv.invoiceNumber || '').toLowerCase().replace(/[\s\-_.]/g, '');
      const supplierClean = (inv.supplier || '').toLowerCase().replace(/[\s\-_.]/g, '');
      if (supplierClean && numClean === supplierClean) continue;
      if (numClean.length < 4) continue; // trop court pour être fiable

      // Clé = numéro de facture normalisé + montant arrondi + même fournisseur
      const key = `${numClean}_${amount}`;

      if (seen[key]) {
        const prev = seen[key];
        // Vérifier que c'est VRAIMENT un doublon :
        // 1. Même fournisseur (ou les deux sans fournisseur)
        const sameSupplier = (prev.supplier || '').toLowerCase() === (inv.supplier || '').toLowerCase();
        // 2. Même date (si disponible)
        const sameDate = (!prev.date && !inv.date) || prev.date === inv.date;
        // 3. Fichiers différents (sinon c'est le même fichier)
        const diffFile = prev.fileName !== inv.fileName;

        if (diffFile && sameSupplier) {
          // C'est un vrai doublon probable
          duplicates.push({
            invoiceNumber: inv.invoiceNumber,
            amount,
            date: inv.date,
            supplier: inv.supplier,
            sameDate,
            confidence: sameDate ? 'Très probable' : 'Probable (dates différentes)',
            files: [prev.fileName, inv.fileName],
          });
        }
      } else {
        seen[key] = inv;
      }
    }

    return duplicates;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PARSE DATE STRING → Date object
  // ═══════════════════════════════════════════════════════════════════════════
  parseDate(str) {
    if (!str) return null;
    const m = str.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (!m) return null;
    let y = parseInt(m[3]);
    if (y < 100) y += 2000;
    if (y < MIN_YEAR || y > MAX_YEAR) return null;
    return new Date(y, parseInt(m[2]) - 1, parseInt(m[1]));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALISATION DES FOURNISSEURS — Fusionner les variantes
  // ═══════════════════════════════════════════════════════════════════════════
  normalizeSuppliers(report) {
    // Mapping de normalisation : variantes → nom canonique
    const aliasMap = {
      'amazon': ['amazon eu', 'amazon europe', 'amazon.fr', 'amazon france', 'amzn', 'amazon eu sarl'],
      'apple': ['apple distribution', 'apple france', 'apple inc'],
      'google': ['google ireland', 'google france', 'google cloud', 'google ads', 'alphabet'],
      'microsoft': ['microsoft ireland', 'microsoft france', 'microsoft 365'],
      'orange': ['orange sa', 'orange france', 'orange business'],
      'sfr': ['sfr sa', 'sfr business'],
      'free': ['free mobile', 'free sas', 'iliad'],
      'bouygues telecom': ['bouygues tel', 'bouygues telecom'],
      'edf': ['edf sa', 'edf france', 'electricite de france'],
      'engie': ['engie sa', 'engie france', 'gdf suez'],
      'totalenergies': ['total energies', 'total', 'totalenergies se'],
      'renault': ['renault sas', 'renault france', 'renault group'],
      'bnp paribas': ['bnp', 'bnp paribas sa'],
      'société générale': ['societe generale', 'sg', 'socgen'],
      'crédit agricole': ['credit agricole', 'ca', 'credit agricole sa'],
      'la poste': ['la poste sa', 'laposte', 'colissimo'],
    };

    // Build reverse lookup
    const normMap = {};
    for (const [canonical, aliases] of Object.entries(aliasMap)) {
      normMap[canonical.toLowerCase()] = canonical.charAt(0).toUpperCase() + canonical.slice(1);
      for (const alias of aliases) {
        normMap[alias.toLowerCase()] = canonical.charAt(0).toUpperCase() + canonical.slice(1);
      }
    }

    // Normalize each invoice's supplier
    for (const inv of report.invoices) {
      if (!inv.supplier) continue;
      const key = inv.supplier.toLowerCase().trim();
      if (normMap[key]) {
        inv.supplier = normMap[key];
      }
    }

    // Rebuild bySupplier
    report.bySupplier = {};
    for (const inv of report.invoices) {
      const supplier = inv.supplier || 'Non identifié';
      if (!report.bySupplier[supplier]) report.bySupplier[supplier] = { count: 0, total: 0, totalHT: 0, totalTVA: 0, invoices: [] };
      report.bySupplier[supplier].count++;
      report.bySupplier[supplier].total += inv.totalTTC || inv.totalAmount || 0;
      report.bySupplier[supplier].totalHT += inv.totalHT || 0;
      report.bySupplier[supplier].totalTVA += inv.totalTVA || 0;
      report.bySupplier[supplier].invoices.push(inv.invoiceNumber || inv.fileName);
    }

    // Update summary
    report.summary.supplierCount = Object.keys(report.bySupplier).length;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTRÔLE COMPTABLE AUTOMATIQUE
  // ═══════════════════════════════════════════════════════════════════════════
  runAccountingControls(invoices) {
    const controls = {
      total: 0,
      errors: [],    // 🔴
      warnings: [],  // 🟠
      ok: 0,         // 🟢
    };

    for (const inv of invoices) {
      controls.total++;
      const issues = [];

      // 1. TVA incohérente : HT + TVA ≠ TTC (tolérance 1€)
      if (inv.totalHT > 0 && inv.totalTVA > 0 && inv.totalTTC > 0) {
        const expected = Math.round((inv.totalHT + inv.totalTVA) * 100) / 100;
        const diff = Math.abs(expected - inv.totalTTC);
        if (diff > 1) {
          issues.push({
            type: 'error',
            code: 'TVA_INCOHERENCE',
            message: `HT (${inv.totalHT}) + TVA (${inv.totalTVA}) = ${expected} ≠ TTC (${inv.totalTTC}) — Écart: ${diff.toFixed(2)}€`,
            invoice: inv.fileName,
          });
        }
      }

      // 2. Taux TVA non standard pour la France
      if (inv.tvaRate && ![0, 2.1, 5.5, 10, 20].includes(inv.tvaRate)) {
        issues.push({
          type: 'warning',
          code: 'TVA_TAUX_NON_STANDARD',
          message: `Taux TVA ${inv.tvaRate}% non standard (France: 0%, 2.1%, 5.5%, 10%, 20%)`,
          invoice: inv.fileName,
        });
      }

      // 3. Vérification TVA calculée vs taux
      if (inv.totalHT > 0 && inv.totalTVA > 0 && inv.tvaRate) {
        const expectedTVA = Math.round(inv.totalHT * inv.tvaRate / 100 * 100) / 100;
        const diffTVA = Math.abs(expectedTVA - inv.totalTVA);
        if (diffTVA > 1) {
          issues.push({
            type: 'warning',
            code: 'TVA_CALCUL',
            message: `TVA attendue (${inv.totalHT} × ${inv.tvaRate}% = ${expectedTVA}€) ≠ TVA facture (${inv.totalTVA}€)`,
            invoice: inv.fileName,
          });
        }
      }

      // 4. Données manquantes critiques
      if (!inv.totalTTC && !inv.totalHT) {
        issues.push({
          type: 'error',
          code: 'MONTANT_MANQUANT',
          message: 'Aucun montant (HT ou TTC) trouvé dans la facture',
          invoice: inv.fileName,
        });
      }

      if (!inv.date) {
        issues.push({
          type: 'warning',
          code: 'DATE_MANQUANTE',
          message: 'Date de facture non trouvée',
          invoice: inv.fileName,
        });
      }

      if (!inv.invoiceNumber) {
        issues.push({
          type: 'warning',
          code: 'NUMERO_MANQUANT',
          message: 'Numéro de facture non trouvé',
          invoice: inv.fileName,
        });
      }

      // 5. Montant suspect (très élevé ou très faible)
      const amount = inv.totalTTC || inv.totalAmount || 0;
      if (amount > 100000) {
        issues.push({
          type: 'warning',
          code: 'MONTANT_ELEVE',
          message: `Montant très élevé: ${amount.toFixed(2)}€ — Vérification manuelle recommandée`,
          invoice: inv.fileName,
        });
      }

      // 6. Date dans le futur
      if (inv.date) {
        const d = this.parseDate(inv.date);
        if (d && d > new Date()) {
          issues.push({
            type: 'warning',
            code: 'DATE_FUTURE',
            message: `Date de facture dans le futur: ${inv.date}`,
            invoice: inv.fileName,
          });
        }
      }

      // Affecter les issues à la facture
      inv.controles = issues;
      inv.controleStatus = issues.some(i => i.type === 'error') ? 'error' : issues.some(i => i.type === 'warning') ? 'warning' : 'ok';

      if (issues.length === 0) {
        controls.ok++;
      } else {
        for (const issue of issues) {
          if (issue.type === 'error') controls.errors.push(issue);
          else controls.warnings.push(issue);
        }
      }
    }

    return controls;
  }
}

module.exports = new ZipProcessor();
