/** Public contact information, configured by the operator rather than in source. */
export function normalizeLegalContactEmail(value: string | null | undefined): string | null {
  const email = value?.trim() ?? "";
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/u.test(email)) return null;
  const domain = email.split("@")[1].toLowerCase();
  if (/(?:^|\.)(?:example\.(?:com|org|net)|invalid|test|localhost)$/u.test(domain)) return null;
  return email;
}

export function legalContactMailto(email: string): string {
  const normalized = normalizeLegalContactEmail(email);
  if (!normalized) throw new Error("invalid_public_contact_email");
  const [local, domain] = normalized.split("@");
  return `mailto:${encodeURIComponent(local)}@${domain}`;
}
