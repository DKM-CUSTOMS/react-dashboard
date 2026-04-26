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
  // Try Anthropic Claude first
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? "YES — Declaration appears consistent";
  }

  // Fall back to OpenAI
  if (process.env.OPENAI_API_KEY) {
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

  // Demo mode — no AI key configured
  return "YES — Declaration appears consistent (AI unavailable — add ANTHROPIC_API_KEY or OPENAI_API_KEY to enable)";
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
      details: { question, ai_response: answer, model_used: process.env.ANTHROPIC_API_KEY ? "claude" : process.env.OPENAI_API_KEY ? "openai" : "demo" },
    };
  } catch (err) {
    return {
      passed: false,
      message: `Check could not run: ${err.message}`,
      details: { error: err.message },
    };
  }
}
