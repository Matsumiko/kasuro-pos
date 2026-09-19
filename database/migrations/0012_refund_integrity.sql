PRAGMA foreign_keys = ON;

CREATE TRIGGER refund_line_quantity_guard
BEFORE INSERT ON refund_lines
WHEN NEW.quantity > (
  SELECT refundable_quantity FROM sale_lines WHERE id = NEW.sale_line_id
)
BEGIN
  SELECT RAISE(ABORT, 'REFUND_LIMIT');
END;

CREATE TRIGGER refund_line_sale_guard
BEFORE INSERT ON refund_lines
WHEN NOT EXISTS (
  SELECT 1
  FROM sale_lines sl
  JOIN refunds r ON r.id = NEW.refund_id
  WHERE sl.id = NEW.sale_line_id AND sl.sale_id = r.sale_id
)
BEGIN
  SELECT RAISE(ABORT, 'REFUND_LINE_SALE_MISMATCH');
END;

CREATE INDEX refunds_business_created ON refunds(business_id,created_at,id);
CREATE INDEX refund_lines_sale ON refund_lines(sale_line_id,created_at,id);
