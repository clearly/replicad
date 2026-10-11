/** Remove a secret from a string before it is shown or thrown. */
export function redactSecret(text, secret) {
  if (!secret || text == null) return text == null ? "" : String(text);
  return String(text).split(secret).join("[redacted]");
}
