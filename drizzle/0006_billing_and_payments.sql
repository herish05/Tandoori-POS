CREATE TABLE `bill_discounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`bill_id` text NOT NULL,
	`scope` text NOT NULL,
	`bill_item_id` text,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`applied_by` text NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_item_id`) REFERENCES `bill_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_discounts_value_check" CHECK("bill_discounts"."value" >= 1 and "bill_discounts"."amount" >= 0),
	CONSTRAINT "bill_discounts_scope_check" CHECK(("bill_discounts"."scope" = 'ITEM') = ("bill_discounts"."bill_item_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `bill_discounts_bill_idx` ON `bill_discounts` (`bill_id`);--> statement-breakpoint
CREATE TABLE `bill_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`bill_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`item_name` text NOT NULL,
	`variant_name` text,
	`food_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`gross` integer NOT NULL,
	`item_discount` integer DEFAULT 0 NOT NULL,
	`bill_discount_share` integer DEFAULT 0 NOT NULL,
	`service_charge_share` integer DEFAULT 0 NOT NULL,
	`taxable_value` integer NOT NULL,
	`tax_name` text,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_items_amounts_check" CHECK("bill_items"."gross" >= 0 and "bill_items"."taxable_value" >= 0)
);
--> statement-breakpoint
CREATE INDEX `bill_items_bill_idx` ON `bill_items` (`bill_id`);--> statement-breakpoint
CREATE TABLE `bill_taxes` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` text NOT NULL,
	`component` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`taxable_amount` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_taxes_amounts_check" CHECK("bill_taxes"."taxable_amount" >= 0 and "bill_taxes"."tax_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `bill_taxes_bill_idx` ON `bill_taxes` (`bill_id`);--> statement-breakpoint
CREATE TABLE `billing_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`tax_mode` text NOT NULL,
	`service_charge_bps` integer DEFAULT 0 NOT NULL,
	`service_charge_dine_in_only` integer DEFAULT true NOT NULL,
	`service_charge_taxable` integer DEFAULT true NOT NULL,
	`round_off_unit` integer DEFAULT 100 NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "billing_settings_service_charge_check" CHECK("billing_settings"."service_charge_bps" between 0 and 3000),
	CONSTRAINT "billing_settings_round_off_check" CHECK("billing_settings"."round_off_unit" in (1, 10, 50, 100))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_settings_restaurant_unique` ON `billing_settings` (`restaurant_id`);--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`bill_number` text NOT NULL,
	`order_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`tax_mode` text NOT NULL,
	`service_charge_bps` integer DEFAULT 0 NOT NULL,
	`service_charge_taxable` integer DEFAULT true NOT NULL,
	`round_off_unit` integer DEFAULT 100 NOT NULL,
	`subtotal` integer NOT NULL,
	`item_discount_total` integer DEFAULT 0 NOT NULL,
	`bill_discount_total` integer DEFAULT 0 NOT NULL,
	`service_charge` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`round_off` integer DEFAULT 0 NOT NULL,
	`grand_total` integer NOT NULL,
	`paid_total` integer DEFAULT 0 NOT NULL,
	`paid_at` integer,
	`cancel_reason` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bills_amounts_check" CHECK("bills"."subtotal" >= 0 and "bills"."grand_total" >= 0 and "bills"."paid_total" >= 0 and "bills"."paid_total" <= "bills"."grand_total")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bills_restaurant_number_unique` ON `bills` (`restaurant_id`,`bill_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `bills_live_order_unique` ON `bills` (`order_id`) WHERE "bills"."status" <> 'CANCELLED' and "bills"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `bills_order_idx` ON `bills` (`order_id`);--> statement-breakpoint
CREATE INDEX `bills_status_idx` ON `bills` (`status`);--> statement-breakpoint
CREATE INDEX `bills_created_idx` ON `bills` (`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`bill_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`tendered` integer NOT NULL,
	`reference` text,
	`received_by` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_check" CHECK("payments"."amount" >= 1 and "payments"."tendered" >= "payments"."amount")
);
--> statement-breakpoint
CREATE INDEX `payments_bill_idx` ON `payments` (`bill_id`);
--> statement-breakpoint
CREATE TRIGGER `bills_identity_immutable` BEFORE UPDATE OF `bill_number`, `order_id`, `restaurant_id`, `created_by` ON `bills`
WHEN NEW.`bill_number` IS NOT OLD.`bill_number` OR NEW.`order_id` IS NOT OLD.`order_id` OR NEW.`restaurant_id` IS NOT OLD.`restaurant_id` OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN
  SELECT RAISE(ABORT, 'A bill cannot be renumbered or moved to another order.');
END;--> statement-breakpoint
CREATE TRIGGER `bills_amounts_locked` BEFORE UPDATE OF `subtotal`, `item_discount_total`, `bill_discount_total`, `service_charge`, `tax_total`, `round_off`, `grand_total`, `tax_mode`, `service_charge_bps`, `service_charge_taxable`, `round_off_unit` ON `bills`
WHEN OLD.`status` <> 'PENDING' AND (NEW.`subtotal` IS NOT OLD.`subtotal` OR NEW.`item_discount_total` IS NOT OLD.`item_discount_total` OR NEW.`bill_discount_total` IS NOT OLD.`bill_discount_total` OR NEW.`service_charge` IS NOT OLD.`service_charge` OR NEW.`tax_total` IS NOT OLD.`tax_total` OR NEW.`round_off` IS NOT OLD.`round_off` OR NEW.`grand_total` IS NOT OLD.`grand_total` OR NEW.`tax_mode` IS NOT OLD.`tax_mode` OR NEW.`service_charge_bps` IS NOT OLD.`service_charge_bps` OR NEW.`service_charge_taxable` IS NOT OLD.`service_charge_taxable` OR NEW.`round_off_unit` IS NOT OLD.`round_off_unit`)
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bills_status_is_final` BEFORE UPDATE OF `status` ON `bills`
WHEN (OLD.`status` = 'CANCELLED' AND NEW.`status` <> 'CANCELLED') OR (OLD.`status` = 'REFUNDED' AND NEW.`status` <> 'REFUNDED') OR (OLD.`status` = 'PAID' AND NEW.`status` IN ('PENDING', 'PARTIAL', 'CANCELLED')) OR (OLD.`status` = 'PARTIAL' AND NEW.`status` IN ('PENDING', 'CANCELLED'))
BEGIN
  SELECT RAISE(ABORT, 'That change of bill status is not allowed.');
END;--> statement-breakpoint
CREATE TRIGGER `bills_no_delete` BEFORE DELETE ON `bills`
BEGIN
  SELECT RAISE(ABORT, 'A bill cannot be deleted. Cancel it instead.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_items_core_immutable` BEFORE UPDATE OF `bill_id`, `order_item_id`, `item_name`, `variant_name`, `food_type`, `quantity`, `unit_price`, `gross`, `tax_name`, `tax_rate_bps` ON `bill_items`
WHEN NEW.`bill_id` IS NOT OLD.`bill_id` OR NEW.`order_item_id` IS NOT OLD.`order_item_id` OR NEW.`item_name` IS NOT OLD.`item_name` OR NEW.`variant_name` IS NOT OLD.`variant_name` OR NEW.`food_type` IS NOT OLD.`food_type` OR NEW.`quantity` IS NOT OLD.`quantity` OR NEW.`unit_price` IS NOT OLD.`unit_price` OR NEW.`gross` IS NOT OLD.`gross` OR NEW.`tax_name` IS NOT OLD.`tax_name` OR NEW.`tax_rate_bps` IS NOT OLD.`tax_rate_bps`
BEGIN
  SELECT RAISE(ABORT, 'A bill item cannot be rewritten.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_items_no_delete` BEFORE DELETE ON `bill_items`
BEGIN
  SELECT RAISE(ABORT, 'A bill item cannot be deleted.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_items_locked_update` BEFORE UPDATE ON `bill_items`
WHEN (SELECT `status` FROM `bills` WHERE `id` = OLD.`bill_id`) <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_items_locked_insert` BEFORE INSERT ON `bill_items`
WHEN (SELECT `status` FROM `bills` WHERE `id` = NEW.`bill_id`) <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_taxes_locked_insert` BEFORE INSERT ON `bill_taxes`
WHEN (SELECT `status` FROM `bills` WHERE `id` = NEW.`bill_id`) <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_taxes_locked_update` BEFORE UPDATE ON `bill_taxes`
WHEN (SELECT `status` FROM `bills` WHERE `id` = OLD.`bill_id`) <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_taxes_locked_delete` BEFORE DELETE ON `bill_taxes`
WHEN (SELECT `status` FROM `bills` WHERE `id` = OLD.`bill_id`) <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_discounts_locked_insert` BEFORE INSERT ON `bill_discounts`
WHEN (SELECT `status` FROM `bills` WHERE `id` = NEW.`bill_id`) <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_discounts_locked_update` BEFORE UPDATE ON `bill_discounts`
WHEN (SELECT `status` FROM `bills` WHERE `id` = OLD.`bill_id`) <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'The amounts on a bill cannot change once payment has started.');
END;--> statement-breakpoint
CREATE TRIGGER `bill_discounts_no_delete` BEFORE DELETE ON `bill_discounts`
BEGIN
  SELECT RAISE(ABORT, 'A discount cannot be deleted from the record.');
END;--> statement-breakpoint
CREATE TRIGGER `payments_only_on_open_bills` BEFORE INSERT ON `payments`
WHEN (SELECT `status` FROM `bills` WHERE `id` = NEW.`bill_id`) NOT IN ('PENDING', 'PARTIAL')
BEGIN
  SELECT RAISE(ABORT, 'This bill cannot take a payment.');
END;--> statement-breakpoint
CREATE TRIGGER `payments_immutable` BEFORE UPDATE OF `bill_id`, `method`, `amount`, `tendered`, `reference`, `received_by`, `received_at` ON `payments`
WHEN NEW.`bill_id` IS NOT OLD.`bill_id` OR NEW.`method` IS NOT OLD.`method` OR NEW.`amount` IS NOT OLD.`amount` OR NEW.`tendered` IS NOT OLD.`tendered` OR NEW.`reference` IS NOT OLD.`reference` OR NEW.`received_by` IS NOT OLD.`received_by` OR NEW.`received_at` IS NOT OLD.`received_at`
BEGIN
  SELECT RAISE(ABORT, 'A payment cannot be changed once it is recorded.');
END;--> statement-breakpoint
CREATE TRIGGER `payments_no_delete` BEFORE DELETE ON `payments`
BEGIN
  SELECT RAISE(ABORT, 'A payment cannot be deleted.');
END;
