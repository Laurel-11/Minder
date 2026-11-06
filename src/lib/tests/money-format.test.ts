// Amounts as people read them, as PayPal expects them, and as a cheque writes them.
import { describe, expect, it } from "vitest";
import { amountInWords, timeAgo } from "../format";
import { toValue, usd } from "../money";

describe("money", () => {
  it("shows dollars with cents", () => {
    expect(usd(129)).toBe("$129.00");
    expect(usd(1234.5)).toBe("$1,234.50");
  });
  it("sends PayPal exactly two decimals, rounded to the cent", () => {
    expect(toValue(12.5)).toBe("12.50");
    expect(toValue(0.1 + 0.2)).toBe("0.30");
    expect(toValue(9.999)).toBe("10.00");
    expect(toValue(15)).toBe("15.00");
  });
});

describe("amountInWords", () => {
  it("writes the amount out the way a cheque does", () => {
    expect(amountInWords(51)).toBe("Fifty-one and 00/100 dollars");
    expect(amountInWords(129)).toBe("One hundred twenty-nine and 00/100 dollars");
    expect(amountInWords(15)).toBe("Fifteen and 00/100 dollars");
  });
  it("keeps the cents as a fraction", () => {
    expect(amountInWords(1234.56)).toBe("One thousand two hundred thirty-four and 56/100 dollars");
    expect(amountInWords(0.5)).toBe("Zero and 50/100 dollars");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-05T12:00:00Z").getTime();
  it("says just now, minutes or hours", () => {
    expect(timeAgo("2026-11-05T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-05T11:45:00Z", now)).toBe("15 min ago");
    expect(timeAgo("2026-11-05T09:00:00Z", now)).toBe("3 h ago");
  });
  it("falls back to the date after a day, and never shows a negative age", () => {
    expect(timeAgo("2026-11-03T12:00:00Z", now)).toBe("Nov 3");
    expect(timeAgo("2026-11-05T12:05:00Z", now)).toBe("just now");
  });
});
