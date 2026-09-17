# Offline sync

Offline support is introduced after the online catalog and checkout contracts exist. The permitted offline operation is a basic cash sale against cached catalog data. Card, QRIS, bank transfer, credit, loyalty redemption, refunds, stock changes, purchasing, and settings remain online-only.

Each queued sale has a client transaction ID and idempotency key. Stock is last-known only while offline; server sync may complete or create an explicit reconciliation conflict.
