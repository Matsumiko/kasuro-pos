PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX refund_lines_once_per_sale_line ON refund_lines(refund_id,sale_line_id);

CREATE TRIGGER refund_line_amount_guard
BEFORE INSERT ON refund_lines
WHEN NEW.amount_minor != (
  SELECT (sl.line_net_minor * NEW.quantity + sl.quantity / 2) / sl.quantity
  FROM sale_lines sl
  WHERE sl.id = NEW.sale_line_id
)
BEGIN
  SELECT RAISE(ABORT, 'REFUND_AMOUNT_MISMATCH');
END;
