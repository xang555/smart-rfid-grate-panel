export const PIN_LENGTH = 6;

export function digitsOnly(s: string, maxlength: number): string {
  return s.replace(/\D/g, '').slice(0, maxlength);
}

// The PIN is a fixed-width code: the row never grows past PIN_LENGTH, so the
// only valid submission is exactly that many digits.
export function isValidPin(s: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(s);
}

// Boxes start at the minimum length and grow by one when the last box is
// filled, so the row never looks full while more digits are still allowed.
export function boxCount(len: number, minlength: number, maxlength: number): number {
  if (len < minlength) return minlength;
  return Math.min(maxlength, len + 1);
}
