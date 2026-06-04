/** Mapping: webhook type → transformation payload → goal string */
const WEBHOOK_TEMPLATES: Record<string, (payload: any) => string> = {
  "onboard-partner": (p) =>
    `Onboard brand partner ${p.brand}, contact ${p.contact}, terms: ${p.terms || "standard"}`,

  "create-campaign": (p) =>
    `Create campaign for ${p.brand}: ${p.description || ""}, budget ${p.budget || "standard"}`,
};

export function payloadToGoal(type: string, payload: any): string {
  const template = WEBHOOK_TEMPLATES[type];
  if (template) return template(payload);
  // Fallback: use raw payload as goal
  return JSON.stringify(payload);
}

export { WEBHOOK_TEMPLATES };
