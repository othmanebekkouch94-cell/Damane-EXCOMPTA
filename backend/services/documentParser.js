const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const { Document } = require('../models');

class DocumentParser {
  async processDocument(documentId) {
    const doc = await Document.findByPk(documentId);
    if (!doc) throw new Error('Document non trouvé');

    try {
      await doc.update({ processingStatus: 'processing' });

      const ext = path.extname(doc.originalName).toLowerCase();
      let result;

      switch (ext) {
        case '.pdf':
          result = await this.parsePDF(doc.storedPath);
          break;
        case '.xlsx':
        case '.xls':
          result = await this.parseExcel(doc.storedPath);
          break;
        case '.csv':
          result = await this.parseCSV(doc.storedPath);
          break;
        case '.jpg':
        case '.jpeg':
        case '.png':
          result = await this.parseImage(doc.storedPath);
          break;
        default:
          throw new Error(`Format non supporté: ${ext}`);
      }

      await doc.update({
        ocrText: result.text || '',
        parsedData: result.data || {},
        processingStatus: 'completed',
      });

      return result;
    } catch (error) {
      await doc.update({
        processingStatus: 'error',
        processingError: error.message,
      });
      throw error;
    }
  }

  async parsePDF(filePath) {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);

    const extractedData = this.extractAccountingData(data.text);

    return {
      text: data.text,
      data: {
        pages: data.numpages,
        ...extractedData,
      },
    };
  }

  async parseExcel(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheets = {};
    const allData = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      sheets[sheetName] = jsonData;
      allData.push(...jsonData);
    }

    const text = allData.map((row) => Object.values(row).join(' | ')).join('\n');

    return {
      text,
      data: {
        sheets: workbook.SheetNames,
        rowCount: allData.length,
        parsedSheets: sheets,
      },
    };
  }

  async parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const workbook = XLSX.read(content, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    return {
      text: content,
      data: {
        rowCount: jsonData.length,
        headers: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
        rows: jsonData,
      },
    };
  }

  async parseImage(filePath) {
    // OCR via Tesseract.js - import dynamique pour ne pas bloquer au démarrage
    try {
      const Tesseract = require('tesseract.js');
      const { data } = await Tesseract.recognize(filePath, 'fra+eng');
      return {
        text: data.text,
        data: { confidence: data.confidence, words: data.words?.length || 0 },
      };
    } catch (error) {
      return {
        text: '',
        data: { error: 'OCR non disponible: ' + error.message },
      };
    }
  }

  extractAccountingData(text) {
    const result = {
      amounts: [],
      dates: [],
      accountNumbers: [],
      invoiceNumbers: [],
    };

    // Extraire montants (format européen : 1.234,56 ou 1234.56)
    const amountRegex = /(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2}))\s*(?:€|EUR)?/g;
    let match;
    while ((match = amountRegex.exec(text)) !== null) {
      result.amounts.push(match[1]);
    }

    // Extraire dates (DD/MM/YYYY)
    const dateRegex = /(\d{2}\/\d{2}\/\d{4})/g;
    while ((match = dateRegex.exec(text)) !== null) {
      result.dates.push(match[1]);
    }

    // Extraire numéros de comptes (3 à 8 chiffres)
    const accountRegex = /\b([1-7]\d{2,7})\b/g;
    while ((match = accountRegex.exec(text)) !== null) {
      result.accountNumbers.push(match[1]);
    }

    // Extraire numéros de facture
    const invoiceRegex = /(?:facture|fact|inv|FA)\s*(?:n[°o]?\s*)?[:.]?\s*([A-Z0-9-]+)/gi;
    while ((match = invoiceRegex.exec(text)) !== null) {
      result.invoiceNumbers.push(match[1]);
    }

    return result;
  }
}

module.exports = new DocumentParser();
