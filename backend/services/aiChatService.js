const { Op } = require('sequelize');
const { JournalEntry, JournalLine, ChartOfAccounts, BankTransaction, Document, sequelize } = require('../models');

class AIChatService {
  constructor() {
    this.anthropicClient = null;
  }

  getClient() {
    if (!this.anthropicClient) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        this.anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      } catch {
        return null;
      }
    }
    return this.anthropicClient;
  }

  async chat(message, conversationHistory, user) {
    // Récupérer le contexte comptable
    const context = await this.getAccountingContext(message);

    const systemPrompt = `Tu es un expert-comptable virtuel pour DAMANE EUROPE.
Tu aides l'équipe comptable avec des questions sur :
- Le plan comptable et les écritures
- L'analyse financière (bilan, compte de résultat, ratios)
- Les obligations fiscales et déclarations
- Le rapprochement bancaire
- L'interprétation de documents comptables

Données contextuelles disponibles :
${JSON.stringify(context, null, 2)}

Réponds toujours en français. Sois précis avec les montants et les comptes.
Si tu n'as pas assez de données, indique-le clairement.`;

    const client = this.getClient();

    if (client) {
      // Utiliser Claude API
      const messages = [
        ...conversationHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user', content: message },
      ];

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages,
      });

      return {
        content: response.content[0].text,
        context,
        model: 'claude',
      };
    }

    // Mode fallback sans API Claude : réponses basiques
    return this.fallbackResponse(message, context);
  }

  async getAccountingContext(message) {
    const context = {};
    const lowerMsg = message.toLowerCase();

    // Détecter les intentions
    if (lowerMsg.includes('chiffre d\'affaires') || lowerMsg.includes('ca') || lowerMsg.includes('ventes')) {
      context.ca = await this.getCA();
    }

    if (lowerMsg.includes('bilan') || lowerMsg.includes('actif') || lowerMsg.includes('passif')) {
      context.bilanSummary = await this.getBilanSummary();
    }

    if (lowerMsg.includes('résultat') || lowerMsg.includes('bénéfice') || lowerMsg.includes('perte')) {
      context.resultat = await this.getResultat();
    }

    if (lowerMsg.includes('trésorerie') || lowerMsg.includes('banque') || lowerMsg.includes('liquidité')) {
      context.tresorerie = await this.getTresorerie();
    }

    if (lowerMsg.includes('rapprochement') || lowerMsg.includes('non rapproché')) {
      context.rapprochement = await this.getRapprochementStatus();
    }

    if (lowerMsg.includes('compte') || lowerMsg.match(/\b\d{3,}\b/)) {
      const accountMatch = lowerMsg.match(/\b(\d{3,})\b/);
      if (accountMatch) {
        context.accountDetail = await this.getAccountDetail(accountMatch[1]);
      }
    }

    // Toujours inclure un résumé
    context.totalEntries = await JournalEntry.count({ where: { status: 'posted' } });
    context.totalDocuments = await Document.count();

    return context;
  }

  async getCA() {
    const currentYear = new Date().getFullYear();
    const result = await JournalLine.findOne({
      attributes: [[sequelize.fn('SUM', sequelize.col('credit')), 'total']],
      include: [
        { model: JournalEntry, where: { status: 'posted', fiscalYear: currentYear }, attributes: [] },
        { model: ChartOfAccounts, as: 'account', where: { accountNumber: { [Op.like]: '70%' } }, attributes: [] },
      ],
      raw: true,
    });
    return { year: currentYear, montant: parseFloat(result?.total) || 0 };
  }

  async getBilanSummary() {
    const currentYear = new Date().getFullYear();
    const results = await JournalLine.findAll({
      attributes: [
        [sequelize.fn('SUM', sequelize.col('debit')), 'totalDebit'],
        [sequelize.fn('SUM', sequelize.col('credit')), 'totalCredit'],
      ],
      include: [
        { model: JournalEntry, where: { status: 'posted', fiscalYear: currentYear }, attributes: [] },
        { model: ChartOfAccounts, as: 'account', where: { accountClass: { [Op.lte]: 5 } }, attributes: ['accountType'] },
      ],
      group: ['account.accountType'],
      raw: true,
    });
    return results;
  }

  async getResultat() {
    const currentYear = new Date().getFullYear();
    const chargesResult = await JournalLine.findOne({
      attributes: [[sequelize.fn('SUM', sequelize.col('debit')), 'total']],
      include: [
        { model: JournalEntry, where: { status: 'posted', fiscalYear: currentYear }, attributes: [] },
        { model: ChartOfAccounts, as: 'account', where: { accountClass: 6 }, attributes: [] },
      ],
      raw: true,
    });
    const produitsResult = await JournalLine.findOne({
      attributes: [[sequelize.fn('SUM', sequelize.col('credit')), 'total']],
      include: [
        { model: JournalEntry, where: { status: 'posted', fiscalYear: currentYear }, attributes: [] },
        { model: ChartOfAccounts, as: 'account', where: { accountClass: 7 }, attributes: [] },
      ],
      raw: true,
    });
    const charges = parseFloat(chargesResult?.total) || 0;
    const produits = parseFloat(produitsResult?.total) || 0;
    return { year: currentYear, charges, produits, resultatNet: produits - charges };
  }

  async getTresorerie() {
    const result = await JournalLine.findOne({
      attributes: [
        [sequelize.fn('SUM', sequelize.col('debit')), 'totalDebit'],
        [sequelize.fn('SUM', sequelize.col('credit')), 'totalCredit'],
      ],
      include: [
        { model: JournalEntry, where: { status: 'posted' }, attributes: [] },
        { model: ChartOfAccounts, as: 'account', where: { accountClass: 5 }, attributes: [] },
      ],
      raw: true,
    });
    const debit = parseFloat(result?.totalDebit) || 0;
    const credit = parseFloat(result?.totalCredit) || 0;
    return { solde: debit - credit };
  }

  async getRapprochementStatus() {
    const total = await BankTransaction.count();
    const reconciled = await BankTransaction.count({ where: { reconciled: true } });
    return { total, reconciled, pending: total - reconciled };
  }

  async getAccountDetail(accountNumber) {
    const account = await ChartOfAccounts.findOne({
      where: { accountNumber: { [Op.like]: `${accountNumber}%` } },
    });
    if (!account) return null;

    const result = await JournalLine.findOne({
      attributes: [
        [sequelize.fn('SUM', sequelize.col('debit')), 'totalDebit'],
        [sequelize.fn('SUM', sequelize.col('credit')), 'totalCredit'],
      ],
      where: { accountId: account.id },
      include: [{ model: JournalEntry, where: { status: 'posted' }, attributes: [] }],
      raw: true,
    });

    return {
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      totalDebit: parseFloat(result?.totalDebit) || 0,
      totalCredit: parseFloat(result?.totalCredit) || 0,
      solde: (parseFloat(result?.totalDebit) || 0) - (parseFloat(result?.totalCredit) || 0),
    };
  }

  async analyzeDocument(documentId, question) {
    const doc = await Document.findByPk(documentId);
    if (!doc) throw new Error('Document non trouvé');

    const client = this.getClient();
    if (!client) {
      return {
        content: `Document: ${doc.originalName}\nType: ${doc.documentType}\nTexte extrait: ${(doc.ocrText || '').substring(0, 500)}...`,
        model: 'fallback',
      };
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'Tu es un expert-comptable. Analyse le document suivant et réponds en français.',
      messages: [{
        role: 'user',
        content: `Document: ${doc.originalName}\nType: ${doc.documentType}\nContenu:\n${doc.ocrText || 'Aucun texte extrait'}\n\nDonnées parsées: ${JSON.stringify(doc.parsedData)}\n\nQuestion: ${question || 'Analyse ce document et résume les informations comptables clés.'}`,
      }],
    });

    return { content: response.content[0].text, model: 'claude' };
  }

  fallbackResponse(message, context) {
    const lowerMsg = message.toLowerCase();

    if (context.ca) {
      return {
        content: `Le chiffre d'affaires pour ${context.ca.year} est de ${context.ca.montant.toLocaleString('fr-FR')} €.\n\nNombre total d'écritures validées : ${context.totalEntries}.`,
        model: 'fallback',
        context,
      };
    }

    if (context.resultat) {
      const r = context.resultat;
      return {
        content: `Résultat ${r.year} :\n- Produits : ${r.produits.toLocaleString('fr-FR')} €\n- Charges : ${r.charges.toLocaleString('fr-FR')} €\n- Résultat net : ${r.resultatNet.toLocaleString('fr-FR')} €`,
        model: 'fallback',
        context,
      };
    }

    if (context.tresorerie) {
      return {
        content: `Trésorerie actuelle : ${context.tresorerie.solde.toLocaleString('fr-FR')} €`,
        model: 'fallback',
        context,
      };
    }

    return {
      content: `Je suis l'assistant comptable DAMANE EUROPE. Je peux vous aider avec :\n- Le chiffre d'affaires et résultats\n- Le bilan et la trésorerie\n- Le rapprochement bancaire\n- L'analyse de documents\n\nPosez votre question !`,
      model: 'fallback',
      context,
    };
  }
}

module.exports = new AIChatService();
