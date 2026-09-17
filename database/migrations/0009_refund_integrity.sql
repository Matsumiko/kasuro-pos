PRAGMA foreign_keys = ON;

CREATE TRIGGER sale_line_refundable_quantity_guard
BEFORE UPDATE OF refundable_quantity ON sale_lines
WHEN NEW.refundable_quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'REFUND_LIMIT');
END;
