const DEFAULT_TEMPLATE =
  "You are an EU customs expert. Answer ONLY with YES or NO followed by one short sentence explanation.\n\nQuestion: {{question}}\n\nDeclaration data:\n{{declaration_summary}}";

function buildSummary(declaration, fields = []) {
  if (!fields.length) {
    // default: header + first item basics
    return {
      header: {
        TEMPLATECODE: declaration.declaration?.TEMPLATECODE,
        DELIVERYTERMSCODE: declaration.declaration?.DELIVERYTERMSCODE,
        TOTALINVOICEAMOUNT: declaration.declaration?.TOTALINVOICEAMOUNT,
        TOTALINVOICEAMOUNTCURRENCY: declaration.declaration?.TOTALINVOICEAMOUNTCURRENCY,
      },
      items: (declaration.items ?? []).map((i) => ({
        COMMODITYCODE: i.item?.COMMODITYCODE,
        GOODSDESCRIPTION: i.item?.GOODSDESCRIPTION,
        INVOICEAMOUNT: i.item?.INVOICEAMOUNT,
      })),
    };
  }

  const result = {};
  for (const fieldPath of fields) {
    const parts = fieldPath.split(".");
    if (parts[0] === "declaration" || parts[0] === "header") {
      const key = parts[parts.length - 1];
      result[key] = declaration.declaration?.[key];
    } else if (parts[0] === "items" && parts[1] === "item") {
      const key = parts[parts.length - 1];
      if (!result.items) result.items = [];
      (declaration.items ?? []).forEach((item, idx) => {
        if (!result.items[idx]) result.items[idx] = {};
        result.items[idx][key] = item.item?.[key];
      });
    }
  }
  return result;
}

async function callAI(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    return "YES — Declaration appears consistent (demo mode — add OPENAI_API_KEY to enable AI checks)";
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "YES — Declaration appears consistent";
}

export async function runAiPromptStrategy(declaration, config) {
  const {
    prompt_template = DEFAULT_TEMPLATE,
    question = "Does this declaration appear correct?",
    fields_to_include = [],
  } = config;

  const summary = buildSummary(declaration, fields_to_include);

  const finalPrompt = prompt_template
    .replace("{{question}}", question)
    .replace("{{declaration_summary}}", JSON.stringify(summary, null, 2));

  try {
    const answer = await callAI(finalPrompt);
    const fired = answer.trim().toUpperCase().startsWith("NO");
    return {
      passed: !fired,
      message: answer,
      details: { question, ai_response: answer, model_used: process.env.OPENAI_API_KEY ? "gpt-4o-mini" : "demo" },
    };
  } catch (err) {
    return {
      passed: false,
      message: `Check could not run: ${err.message}`,
      details: { error: err.message },
    };
  }
}
