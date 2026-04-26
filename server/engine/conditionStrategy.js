// Extracts the leaf key from a dotted path like "declaration.DELIVERYTERMSCODE" → "DELIVERYTERMSCODE"
function leafKey(fieldPath) {
  const parts = fieldPath.split(".");
  return parts[parts.length - 1];
}

function resolveValues(declaration, fieldPath, scope) {
  const key = leafKey(fieldPath);

  if (scope === "header") {
    const val = declaration.declaration?.[key];
    return [val ?? null];
  }

  if (scope === "item") {
    return (declaration.items ?? []).map((i) => i.item?.[key] ?? null);
  }

  if (scope === "document") {
    return (declaration.items ?? []).flatMap((i) =>
      (i.documents ?? []).map((d) => d[key] ?? null)
    );
  }

  if (scope === "fiscal") {
    return (declaration.declarationLevel?.fiscalReference ?? []).map((f) => f[key] ?? null);
  }

  return [null];
}

function matchOp(value, operator, target) {
  if (value === null || value === undefined) {
    if (operator === "isEmpty") return true;
    if (operator === "isNotEmpty") return false;
    return false;
  }
  const v = String(value);
  switch (operator) {
    case "equals":        return v === String(target);
    case "notEquals":     return v !== String(target);
    case "greaterThan":   return Number(value) > Number(target);
    case "lessThan":      return Number(value) < Number(target);
    case "contains":      return v.includes(String(target));
    case "isEmpty":       return v === "" || v === "null" || v === "undefined";
    case "isNotEmpty":    return v !== "" && v !== "null" && v !== "undefined";
    case "isOneOf":       return (Array.isArray(target) ? target : String(target).split(",").map(s => s.trim())).includes(v);
    case "isNotOneOf":    return !(Array.isArray(target) ? target : String(target).split(",").map(s => s.trim())).includes(v);
    default:              return false;
  }
}

function evalCondition(declaration, condition) {
  const { field, operator, value, scope, itemMatch = "any" } = condition;
  const values = resolveValues(declaration, field, scope);

  if (scope === "item") {
    const hits = values.map((v) => matchOp(v, operator, value));
    return itemMatch === "all" ? hits.every(Boolean) : hits.some(Boolean);
  }

  // header / document / fiscal — any match fires
  return values.some((v) => matchOp(v, operator, value));
}

export function runConditionStrategy(declaration, config) {
  const { logic = "AND", conditions = [] } = config;

  if (!conditions.length) {
    return { passed: true, message: "No conditions configured", details: {} };
  }

  const evaluated = conditions.map((cond) => ({
    field: cond.field,
    operator: cond.operator,
    value: cond.value,
    fired: evalCondition(declaration, cond),
  }));

  // A condition strategy fires (= check fails) when the condition tree is TRUE
  const conditionFired =
    logic === "AND" ? evaluated.every((e) => e.fired) : evaluated.some((e) => e.fired);

  return {
    passed: !conditionFired,
    message: conditionFired ? "Condition matched — review required" : "No issues detected",
    details: { logic, evaluated },
  };
}
