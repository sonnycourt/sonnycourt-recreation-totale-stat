// One-time masterclass entry only. Never use these identifiers for ES2 contracts.
export const MC2_ENTRY_CHECKOUT_SLUG = 'masterclass-es2-27';
export const MC2_ENTRY_AMOUNT_MINOR = 2700;
export const MC2_ENTRY_CURRENCY = 'eur';
export const MC2_ENTRY_PRODUCT_ID = '11870';
export const MC2_ENTRY_CHECKOUT_ID = '40689';
export const mc2EntryPaymentPending = row => row?.entry_payment_required === true && !row?.entry_payment_paid_at;
