import { runConditionStrategy } from "./conditionStrategy.js";
import { runAiPromptStrategy } from "./aiPromptStrategy.js";

// Mock declaration returned when Streamliner is unavailable (demo mode)
export const MOCK_DECLARATION = {
  declaration: {
    DECLARATIONID: 158493,
    TYPEDECLARATIONSSW: "IDMS_IMPORT",
    TEMPLATECODE: "4200 FISCAL",
    DELIVERYTERMSCODE: "EXW",
    DELIVERYTERMSCOUNTRY: "CN",
    TOTALGROSSMASS: 450.5,
    CONTROLNETMASS: 420.0,
    CONTROLPACKAGES: 12,
    TOTALINVOICEAMOUNT: 8500.00,
    TOTALINVOICEAMOUNTCURRENCY: "USD",
    DESTINATIONCOUNTRY: "BE",
    DISPATCHCOUNTRY: "CN",
    DECLARATIONTYPE: "IM",
    FISCALDIRECTTRANSIT: 0,
    MRN: "24BE00012345678901",
    LRN: "DKM-2024-158493",
    PROCEDURETYPESSW: "H1",
    DECLARATIONTAXSTATUS: "E",
  },
  items: [
    {
      item: {
        COMMODITYCODE: "85171300",
        PROCEDURECURRENT: "42",
        PROCEDUREPREVIOUS: "00",
        ORIGINCOUNTRY: "CN",
        PREFERENCE: "100",
        VALUATIONMETHOD: "1",
        GROSSMASS: 225.25,
        NETMASS: 210.0,
        SUPPLEMENTARYUNITS: 6,
        UNITCODE: "p/st",
        INVOICEAMOUNT: 4250.00,
        INVOICEAMOUNTCURRENCY: "USD",
        STATISTICALVALUE: 4800.00,
        GOODSDESCRIPTION: "Smartphones, mobile telephones",
        PAYMENTMETHOD: "E",
        ADDITIONALPROCEDURECODE1: "F15",
        CUSTOMSVALUEAMOUNT: 4250.00,
      },
      documents: [
        { DOCUMENTTYPE: "N935", REFERENCE: "INV-2024-001", DATEOFVALIDITY: "20251231" },
        { DOCUMENTTYPE: "Y025", REFERENCE: "EORI-BE0123456789", DATEOFVALIDITY: "" },
      ],
      packaging: [{ MARKSANDNUMBERS: "PKG001-006", NUMBERSOFPACKAGES: 6, KINDOFPACKAGES: "CT" }],
      additionAndDeduction: [
        { CODE: "AK_TRANSPORTCOST", AMOUNTEUR: 280.50 },
        { CODE: "AK_INSURANCECOST", AMOUNTEUR: 42.25 },
      ],
      containers: [{ CONTAINERNUMBER: "MSCU1234567" }],
    },
    {
      item: {
        COMMODITYCODE: "84713000",
        PROCEDURECURRENT: "42",
        PROCEDUREPREVIOUS: "00",
        ORIGINCOUNTRY: "CN",
        PREFERENCE: "100",
        VALUATIONMETHOD: "1",
        GROSSMASS: 225.25,
        NETMASS: 210.0,
        SUPPLEMENTARYUNITS: 6,
        UNITCODE: "p/st",
        INVOICEAMOUNT: 4250.00,
        INVOICEAMOUNTCURRENCY: "USD",
        STATISTICALVALUE: 4400.00,
        GOODSDESCRIPTION: "Portable computers, laptops",
        PAYMENTMETHOD: "E",
        CUSTOMSVALUEAMOUNT: 4250.00,
      },
      documents: [
        { DOCUMENTTYPE: "N935", REFERENCE: "INV-2024-002", DATEOFVALIDITY: "20251231" },
      ],
      packaging: [],
      additionAndDeduction: [],
      containers: [],
    },
  ],
  declarationLevel: {
    additionalInfo: [],
    fiscalReference: [
      { ROLE: "FR1", VATIDENTIFICATION: "BE0123456789", RELATIONCODE: "1" },
    ],
    responseTaxData: [
      { DUTYTAXTYPE: "A00", TOTALPAYMENTAMOUNT: 340.00, DUTYVALUEINEURO: 4250.00 },
      { DUTYTAXTYPE: "B00", TOTALPAYMENTAMOUNT: 892.50, DUTYVALUEINEURO: 4250.00 },
    ],
    responseTaxDataCalculate: [],
  },
};

async function fetchFromStreamliner(declarationId) {
  const url = process.env.STREAMLINER_LOGIC_APP_URL;
  if (!url) return null; // no URL configured → demo mode

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ declarationId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Streamliner Logic App returned ${res.status}: ${text}`);
  }

  return res.json();
}

async function runOneCheck(declaration, check) {
  const base = { checkId: check.id, checkName: check.name, severity: check.severity };

  if (!check.is_active) {
    return { ...base, passed: true, message: "Check is disabled", details: {} };
  }

  try {
    switch (check.strategy_type) {
      case "condition":
        return { ...base, ...runConditionStrategy(declaration, check.config) };

      case "ai_prompt":
        return { ...base, ...(await runAiPromptStrategy(declaration, check.config)) };

      case "composite": {
        const { logic = "AND", steps = [] } = check.config;
        const subResults = await Promise.all(
          steps.map((step) => runOneCheck(declaration, { ...check, ...step, id: check.id, name: check.name }))
        );
        const allPassed =
          logic === "AND" ? subResults.every((r) => r.passed) : subResults.some((r) => r.passed);
        return { ...base, passed: allPassed, message: allPassed ? "All sub-checks passed" : "One or more sub-checks failed", details: { steps: subResults } };
      }

      case "db_lookup":
      case "cross_declaration":
      case "external_api":
        return { ...base, passed: true, message: `[stub] ${check.strategy_type} — not yet connected`, details: { strategy_type: check.strategy_type } };

      default:
        return { ...base, passed: false, message: `Unknown strategy type: ${check.strategy_type}`, details: {} };
    }
  } catch (err) {
    return { ...base, passed: false, message: `Check could not run: ${err.message}`, details: { error: err.message } };
  }
}

export async function runEngine(declarationId, checks) {
  let declaration;
  let isDemo = false;

  try {
    const fetched = await fetchFromStreamliner(declarationId);
    if (fetched) {
      declaration = fetched;
    } else {
      declaration = MOCK_DECLARATION;
      isDemo = true;
    }
  } catch (err) {
    return { error: err.message, declaration: null, results: [], isDemo: false };
  }

  const activeChecks = checks.filter((c) => c.is_active).sort((a, b) => a.order_index - b.order_index);

  const results = [];
  for (const check of activeChecks) {
    const result = await runOneCheck(declaration, check);
    // Override message with custom warning_message if check failed and one is set
    if (!result.passed && check.warning_message) {
      result.message = check.warning_message;
    }
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const warned = results.filter((r) => !r.passed && r.severity !== "info").length;
  const info = results.filter((r) => !r.passed && r.severity === "info").length;

  return {
    declaration,
    isDemo,
    results,
    summary: { total: results.length, passed, warned, info },
  };
}
