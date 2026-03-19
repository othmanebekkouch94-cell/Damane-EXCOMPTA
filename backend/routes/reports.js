const express = require('express');
const { Op } = require('sequelize');
const { JournalEntry, JournalLine, ChartOfAccounts, BankTransaction, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/bilan - Bilan comptable
router.get('/bilan', authenticate, async (req, res) => {
  try {
    const { fiscalYear } = req.query;
    if (!fiscalYear) return res.status(400).json({ error: 'fiscalYear requis' });

    const results = await JournalLine.findAll({
      attributes: [
        'accountId',
        [sequelize.fn('SUM', sequelize.col('debit')), 'totalDebit'],
        [sequelize.fn('SUM', sequelize.col('credit')), 'totalCredit'],
      ],
      include: [
        {
          model: JournalEntry,
          where: { status: 'posted', fiscalYear },
          attributes: [],
        },
        {
          model: ChartOfAccounts,
          as: 'account',
          where: { accountClass: { [Op.lte]: 5 } },
          attributes: ['accountNumber', 'accountName', 'accountType', 'accountClass', 'normalBalance'],
        },
      ],
      group: ['JournalLine.accountId', 'account.id'],
      order: [[{ model: ChartOfAccounts, as: 'account' }, 'accountNumber', 'ASC']],
      raw: false,
    });

    const actif = { immobilisations: [], actifCirculant: [], tresorerie: [], total: 0 };
    const passif = { capitaux: [], dettes: [], total: 0 };

    for (const r of results) {
      const debit = parseFloat(r.getDataValue('totalDebit')) || 0;
      const credit = parseFloat(r.getDataValue('totalCredit')) || 0;
      const solde = r.account.normalBalance === 'debit' ? debit - credit : credit - debit;

      const item = {
        accountNumber: r.account.accountNumber,
        accountName: r.account.accountName,
        solde: Math.abs(solde),
        sens: solde >= 0 ? r.account.normalBalance : (r.account.normalBalance === 'debit' ? 'credit' : 'debit'),
      };

      if (r.account.accountType === 'actif') {
        if (r.account.accountClass === 2) actif.immobilisations.push(item);
        else if (r.account.accountClass <= 4) actif.actifCirculant.push(item);
        else actif.tresorerie.push(item);
        actif.total += solde;
      } else {
        if (r.account.accountClass === 1) passif.capitaux.push(item);
        else passif.dettes.push(item);
        passif.total += solde;
      }
    }

    res.json({ bilan: { actif, passif, fiscalYear: parseInt(fiscalYear) } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/resultat - Compte de résultat
router.get('/resultat', authenticate, async (req, res) => {
  try {
    const { fiscalYear } = req.query;
    if (!fiscalYear) return res.status(400).json({ error: 'fiscalYear requis' });

    const results = await JournalLine.findAll({
      attributes: [
        'accountId',
        [sequelize.fn('SUM', sequelize.col('debit')), 'totalDebit'],
        [sequelize.fn('SUM', sequelize.col('credit')), 'totalCredit'],
      ],
      include: [
        {
          model: JournalEntry,
          where: { status: 'posted', fiscalYear },
          attributes: [],
        },
        {
          model: ChartOfAccounts,
          as: 'account',
          where: { accountClass: { [Op.in]: [6, 7] } },
          attributes: ['accountNumber', 'accountName', 'accountType', 'accountClass'],
        },
      ],
      group: ['JournalLine.accountId', 'account.id'],
      order: [[{ model: ChartOfAccounts, as: 'account' }, 'accountNumber', 'ASC']],
      raw: false,
    });

    const charges = [];
    const produits = [];
    let totalCharges = 0;
    let totalProduits = 0;

    for (const r of results) {
      const debit = parseFloat(r.getDataValue('totalDebit')) || 0;
      const credit = parseFloat(r.getDataValue('totalCredit')) || 0;

      const item = {
        accountNumber: r.account.accountNumber,
        accountName: r.account.accountName,
      };

      if (r.account.accountClass === 6) {
        item.montant = debit - credit;
        charges.push(item);
        totalCharges += item.montant;
      } else {
        item.montant = credit - debit;
        produits.push(item);
        totalProduits += item.montant;
      }
    }

    res.json({
      compteResultat: {
        charges,
        produits,
        totalCharges,
        totalProduits,
        resultatNet: totalProduits - totalCharges,
        fiscalYear: parseInt(fiscalYear),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/dashboard - KPIs BIG4
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const { fiscalYear } = req.query;
    const currentYear = fiscalYear || new Date().getFullYear();
    const prevYear = parseInt(currentYear) - 1;

    // Helper: get sum for account pattern
    const getSum = async (year, where, sumField = 'credit') => {
      const r = await JournalLine.findOne({
        attributes: [[sequelize.fn('SUM', sequelize.col(sumField)), 'total']],
        include: [
          { model: JournalEntry, where: { status: 'posted', fiscalYear: year }, attributes: [] },
          { model: ChartOfAccounts, as: 'account', where, attributes: [] },
        ],
        raw: true,
      });
      return parseFloat(r?.total) || 0;
    };

    // Helper: get debit-credit balance for account class
    const getBalance = async (year, where) => {
      const r = await JournalLine.findOne({
        attributes: [
          [sequelize.fn('SUM', sequelize.col('debit')), 'totalDebit'],
          [sequelize.fn('SUM', sequelize.col('credit')), 'totalCredit'],
        ],
        include: [
          { model: JournalEntry, where: { status: 'posted', fiscalYear: year }, attributes: [] },
          { model: ChartOfAccounts, as: 'account', where, attributes: [] },
        ],
        raw: true,
      });
      return {
        debit: parseFloat(r?.totalDebit) || 0,
        credit: parseFloat(r?.totalCredit) || 0,
      };
    };

    // === CURRENT YEAR ===
    // CA (comptes 70x)
    const ca = await getSum(currentYear, { accountNumber: { [Op.like]: '70%' } }, 'credit');
    // Autres produits (71-79)
    const autresProduits = await getSum(currentYear, { accountClass: 7, accountNumber: { [Op.notLike]: '70%' } }, 'credit');
    // Total charges (classe 6)
    const charges = await getSum(currentYear, { accountClass: 6 }, 'debit');
    // Charges par type
    const achats = await getSum(currentYear, { accountNumber: { [Op.like]: '60%' } }, 'debit');
    const servicesExt = await getSum(currentYear, { accountNumber: { [Op.like]: '61%' } }, 'debit');
    const autresServicesExt = await getSum(currentYear, { accountNumber: { [Op.like]: '62%' } }, 'debit');
    const impots = await getSum(currentYear, { accountNumber: { [Op.like]: '63%' } }, 'debit');
    const personnel = await getSum(currentYear, { accountNumber: { [Op.like]: '64%' } }, 'debit');
    const autresCharges = await getSum(currentYear, { accountNumber: { [Op.like]: '65%' } }, 'debit');
    const chargesFinancieres = await getSum(currentYear, { accountNumber: { [Op.like]: '66%' } }, 'debit');
    const chargesExcept = await getSum(currentYear, { accountNumber: { [Op.like]: '67%' } }, 'debit');
    const dotations = await getSum(currentYear, { accountNumber: { [Op.like]: '68%' } }, 'debit');

    // Trésorerie (comptes 5xx)
    const treso = await getBalance(currentYear, { accountClass: 5 });
    const tresorerie = treso.debit - treso.credit;

    // Bilan simplifié - Actif
    const immobilisations = await getBalance(currentYear, { accountClass: 2 });
    const stocks = await getBalance(currentYear, { accountNumber: { [Op.like]: '3%' } });
    const creances = await getBalance(currentYear, { accountNumber: { [Op.like]: '4%' }, accountType: 'actif' });

    // Bilan simplifié - Passif
    const capitaux = await getBalance(currentYear, { accountClass: 1 });
    const dettes = await getBalance(currentYear, { accountNumber: { [Op.like]: '4%' }, accountType: 'passif' });

    // TVA
    const tvaCollectee = await getSum(currentYear, { accountNumber: { [Op.like]: '4457%' } }, 'credit');
    const tvaDeductible = await getSum(currentYear, { accountNumber: { [Op.like]: '4456%' } }, 'debit');

    // === PREVIOUS YEAR (for comparison) ===
    const caPrev = await getSum(prevYear, { accountNumber: { [Op.like]: '70%' } }, 'credit');
    const chargesPrev = await getSum(prevYear, { accountClass: 6 }, 'debit');
    const tresoPrev = await getBalance(prevYear, { accountClass: 5 });

    // Écritures par mois
    const monthlyEntries = await JournalEntry.findAll({
      attributes: [
        'period',
        [sequelize.fn('COUNT', sequelize.col('JournalEntry.id')), 'count'],
        [sequelize.fn('SUM', sequelize.col('totalDebit')), 'totalDebit'],
      ],
      where: { status: 'posted', fiscalYear: currentYear },
      group: ['period'],
      order: [['period', 'ASC']],
      raw: true,
    });

    // Produits par mois (pour chart CA vs Charges)
    const monthlyProduits = await JournalLine.findAll({
      attributes: [
        [sequelize.fn('strftime', '%m', sequelize.col('JournalEntry.entryDate')), 'month'],
        [sequelize.fn('SUM', sequelize.col('JournalLine.credit')), 'totalProduits'],
      ],
      include: [
        { model: JournalEntry, where: { status: 'posted', fiscalYear: currentYear }, attributes: [] },
        { model: ChartOfAccounts, as: 'account', where: { accountClass: 7 }, attributes: [] },
      ],
      group: [sequelize.fn('strftime', '%m', sequelize.col('JournalEntry.entryDate'))],
      raw: true,
    });

    const monthlyCharges = await JournalLine.findAll({
      attributes: [
        [sequelize.fn('strftime', '%m', sequelize.col('JournalEntry.entryDate')), 'month'],
        [sequelize.fn('SUM', sequelize.col('JournalLine.debit')), 'totalCharges'],
      ],
      include: [
        { model: JournalEntry, where: { status: 'posted', fiscalYear: currentYear }, attributes: [] },
        { model: ChartOfAccounts, as: 'account', where: { accountClass: 6 }, attributes: [] },
      ],
      group: [sequelize.fn('strftime', '%m', sequelize.col('JournalEntry.entryDate'))],
      raw: true,
    });

    // Nombre d'écritures total
    const totalEntries = await JournalEntry.count({ where: { status: 'posted', fiscalYear: currentYear } });
    const totalAccounts = await ChartOfAccounts.count();

    // Transactions non rapprochées
    const unreconciledCount = await BankTransaction.count({ where: { reconciled: false } });
    const totalBankTx = await BankTransaction.count();

    // Calculations
    const totalProduits = ca + autresProduits;
    const resultatNet = totalProduits - charges;
    const resultatExploitation = ca + autresProduits - (achats + servicesExt + autresServicesExt + impots + personnel + autresCharges + dotations);
    const resultatFinancier = -chargesFinancieres;
    const resultatExceptionnel = -chargesExcept;

    const margeNette = ca > 0 ? ((resultatNet / ca) * 100) : 0;
    const margeBrute = ca > 0 ? (((ca - achats) / ca) * 100) : 0;
    const margeExploitation = ca > 0 ? ((resultatExploitation / ca) * 100) : 0;

    // Ratios BIG4
    const totalActif = (immobilisations.debit - immobilisations.credit) + (stocks.debit - stocks.credit) + (creances.debit - creances.credit) + tresorerie;
    const totalPassif = (capitaux.credit - capitaux.debit) + (dettes.credit - dettes.debit);
    const fondsPropres = capitaux.credit - capitaux.debit;
    const totalDettes = (dettes.credit - dettes.debit);

    const ratioLiquidite = totalDettes > 0 ? ((tresorerie + (creances.debit - creances.credit)) / totalDettes) : 0;
    const ratioEndettement = fondsPropres > 0 ? (totalDettes / fondsPropres * 100) : 0;
    const roe = fondsPropres > 0 ? (resultatNet / fondsPropres * 100) : 0;
    const roa = totalActif > 0 ? (resultatNet / totalActif * 100) : 0;

    // Variation N/N-1
    const variationCA = caPrev > 0 ? (((ca - caPrev) / caPrev) * 100) : 0;
    const variationCharges = chargesPrev > 0 ? (((charges - chargesPrev) / chargesPrev) * 100) : 0;
    const resultatPrev = caPrev - chargesPrev;
    const variationResultat = resultatPrev !== 0 ? (((resultatNet - resultatPrev) / Math.abs(resultatPrev)) * 100) : 0;
    const tresoPrevSolde = tresoPrev.debit - tresoPrev.credit;
    const variationTreso = tresoPrevSolde !== 0 ? (((tresorerie - tresoPrevSolde) / Math.abs(tresoPrevSolde)) * 100) : 0;

    // Monthly chart data
    const monthNames = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyCA = {};
    const monthlyCh = {};
    monthlyProduits.forEach(m => { monthlyCA[parseInt(m.month)] = parseFloat(m.totalProduits) || 0; });
    monthlyCharges.forEach(m => { monthlyCh[parseInt(m.month)] = parseFloat(m.totalCharges) || 0; });

    const monthlyChartData = monthNames.map((name, i) => ({
      name,
      produits: monthlyCA[i + 1] || 0,
      charges: monthlyCh[i + 1] || 0,
      resultat: (monthlyCA[i + 1] || 0) - (monthlyCh[i + 1] || 0),
      ecritures: 0,
    }));

    // Merge entry counts
    monthlyEntries.forEach(m => {
      const idx = parseInt(m.period) - 1;
      if (idx >= 0 && idx < 12) {
        monthlyChartData[idx].ecritures = parseInt(m.count);
        if (!monthlyChartData[idx].produits && !monthlyChartData[idx].charges) {
          monthlyChartData[idx].produits = parseFloat(m.totalDebit) || 0;
        }
      }
    });

    res.json({
      dashboard: {
        fiscalYear: parseInt(currentYear),
        // KPIs principaux
        chiffreAffaires: ca,
        totalProduits,
        totalCharges: charges,
        resultatNet,
        tresorerie,
        // Résultats détaillés
        resultatExploitation,
        resultatFinancier,
        resultatExceptionnel,
        // Marges
        margeNette: parseFloat(margeNette.toFixed(2)),
        margeBrute: parseFloat(margeBrute.toFixed(2)),
        margeExploitation: parseFloat(margeExploitation.toFixed(2)),
        // Charges détaillées
        detailCharges: {
          achats,
          servicesExterieurs: servicesExt + autresServicesExt,
          impots,
          personnel,
          autresCharges,
          chargesFinancieres,
          chargesExceptionnelles: chargesExcept,
          dotations,
        },
        // Bilan simplifié
        bilan: {
          actif: {
            immobilisations: immobilisations.debit - immobilisations.credit,
            stocks: stocks.debit - stocks.credit,
            creances: creances.debit - creances.credit,
            tresorerie,
            total: totalActif,
          },
          passif: {
            fondsPropres,
            dettes: totalDettes,
            total: totalPassif,
          },
        },
        // TVA
        tva: {
          collectee: tvaCollectee,
          deductible: tvaDeductible,
          aPayer: tvaCollectee - tvaDeductible,
        },
        // Ratios BIG4
        ratios: {
          liquidite: parseFloat(ratioLiquidite.toFixed(2)),
          endettement: parseFloat(ratioEndettement.toFixed(2)),
          roe: parseFloat(roe.toFixed(2)),
          roa: parseFloat(roa.toFixed(2)),
        },
        // Variations N-1
        variations: {
          ca: parseFloat(variationCA.toFixed(2)),
          charges: parseFloat(variationCharges.toFixed(2)),
          resultat: parseFloat(variationResultat.toFixed(2)),
          tresorerie: parseFloat(variationTreso.toFixed(2)),
        },
        // Previous year values
        previousYear: {
          ca: caPrev,
          charges: chargesPrev,
          resultat: resultatPrev,
          tresorerie: tresoPrevSolde,
        },
        // Charts
        monthlyChartData,
        ecrituresParMois: monthlyEntries,
        // Metadata
        totalEntries,
        totalAccounts,
        transactionsNonRapprochees: unreconciledCount,
        totalBankTransactions: totalBankTx,
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
