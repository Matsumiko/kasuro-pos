PRAGMA foreign_keys = ON;

-- A register has one active drawer at a time, regardless of which cashier owns it.
CREATE UNIQUE INDEX active_register_shift ON shifts(register_id) WHERE status IN ('open','closing');
