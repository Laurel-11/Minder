export const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/** Round to cents and format the way PayPal expects ("12.50"). */
export const toValue = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
