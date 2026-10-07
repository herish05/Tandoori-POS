ALTER TABLE `orders` ADD `promised_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `rider_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `rider_phone` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `dispatched_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `dispatched_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `handed_over_at` integer;--> statement-breakpoint
ALTER TABLE `billing_settings` ADD `delivery_charge` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_settings` ADD `delivery_free_above` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_settings` ADD `delivery_charge_tax_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_settings` ADD `packaging_charge` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_settings` ADD `packaging_charge_tax_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `delivery_charge` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `delivery_charge_tax_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `packaging_charge` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `packaging_charge_tax_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP TRIGGER `bills_amounts_locked`;--> statement-breakpoint
CREATE TRIGGER `bills_amounts_locked` BEFORE UPDATE OF `subtotal`, `item_discount_total`, `bill_discount_total`, `service_charge`, `tax_total`, `round_off`, `grand_total`, `tax_mode`, `service_charge_bps`, `service_charge_taxable`, `round_off_unit`, `delivery_charge`, `delivery_charge_tax_bps`, `packaging_charge`, `packaging_charge_tax_bps` ON `bills`
WHEN OLD.`status` <> 'PENDING' AND (NEW.`subtotal` IS NOT OLD.`subtotal` OR NEW.`item_discount_total` IS NOT OLD.`item_discount_total` OR NEW.`bill_discount_total` IS NOT OLD.`bill_discount_total` OR NEW.`service_charge` IS NOT OLD.`service_charge` OR NEW.`tax_total` IS NOT OLD.`tax_total` OR NEW.`round_off` IS NOT OLD.`round_off` OR NEW.`grand_total` IS NOT OLD.`grand_total` OR NEW.`tax_mode` IS NOT OLD.`tax_mode` OR NEW.`service_charge_bps` IS NOT OLD.`service_charge_bps` OR NEW.`service_charge_taxable` IS NOT OLD.`service_charge_taxable` OR NEW.`round_off_unit` IS NOT OLD.`round_off_unit` OR NEW.`delivery_charge` IS NOT OLD.`delivery_charge` OR NEW.`delivery_charge_tax_bps` IS NOT OLD.`delivery_charge_tax_bps` OR NEW.`packaging_charge` IS NOT OLD.`packaging_charge` OR NEW.`packaging_charge_tax_bps` IS NOT OLD.`packaging_charge_tax_bps`)
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `orders_dispatch_delivery_only` BEFORE UPDATE OF `dispatched_at`, `rider_name`, `rider_phone` ON `orders`
WHEN NEW.`type` <> 'DELIVERY' AND (NEW.`dispatched_at` IS NOT NULL OR NEW.`rider_name` IS NOT NULL OR NEW.`rider_phone` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Only a delivery order can be sent out with a rider.');
END;--> statement-breakpoint
CREATE TRIGGER `orders_promise_not_dine_in` BEFORE UPDATE OF `promised_at` ON `orders`
WHEN NEW.`type` = 'DINE_IN' AND NEW.`promised_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A dine-in order has no promised time.');
END;
