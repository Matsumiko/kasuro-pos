PRAGMA foreign_keys = ON;

CREATE TRIGGER inventory_prevent_negative
BEFORE UPDATE OF quantity_on_hand ON inventory_balances
WHEN NEW.quantity_on_hand < 0
  AND EXISTS (
    SELECT 1 FROM business_settings
    WHERE business_id = NEW.business_id AND stock_policy = 'prevent_negative'
  )
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;
