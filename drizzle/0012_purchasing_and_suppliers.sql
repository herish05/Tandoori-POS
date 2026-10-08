CREATE TABLE `purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`purchase_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`item_name` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`line_total` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_lines_amounts_check" CHECK("purchase_lines"."quantity" > 0 and "purchase_lines"."unit_cost" >= 0 and "purchase_lines"."line_total" >= 0)
);
--> statement-breakpoint
CREATE INDEX `purchase_lines_purchase_idx` ON `purchase_lines` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `purchase_lines_item_idx` ON `purchase_lines` (`inventory_item_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`purchase_number` text NOT NULL,
	`supplier_id` text NOT NULL,
	`invoice_number` text,
	`purchase_date` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`amount_paid` integer DEFAULT 0 NOT NULL,
	`received_at` integer,
	`received_by` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`cancel_reason` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchases_amounts_check" CHECK("purchases"."subtotal" >= 0 and "purchases"."discount" >= 0 and "purchases"."discount" <= "purchases"."subtotal" and "purchases"."tax" >= 0 and "purchases"."total" = "purchases"."subtotal" - "purchases"."discount" + "purchases"."tax" and "purchases"."amount_paid" >= 0 and "purchases"."amount_paid" <= "purchases"."total")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_number_unique` ON `purchases` (`restaurant_id`,`purchase_number`);--> statement-breakpoint
CREATE INDEX `purchases_supplier_idx` ON `purchases` (`supplier_id`,`purchase_date`);--> statement-breakpoint
CREATE INDEX `purchases_status_idx` ON `purchases` (`status`);--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`notes` text,
	`paid_at` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_payments_amount_check" CHECK("supplier_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `supplier_payments_purchase_idx` ON `supplier_payments` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `supplier_payments_supplier_idx` ON `supplier_payments` (`supplier_id`,`paid_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_person` text,
	`phone` text,
	`email` text,
	`address` text,
	`gstin` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_restaurant_name_unique` ON `suppliers` (`restaurant_id`,`name`) WHERE "suppliers"."deleted_at" is null;
--> statement-breakpoint
CREATE TRIGGER `purchases_status_flow` BEFORE UPDATE OF `status` ON `purchases`
WHEN OLD.`status` <> NEW.`status` AND NOT (OLD.`status` = 'DRAFT' AND NEW.`status` IN ('RECEIVED', 'CANCELLED'))
BEGIN
  SELECT RAISE(ABORT, 'A purchase can only move from draft to received or cancelled.');
END;
--> statement-breakpoint
CREATE TRIGGER `purchases_locked` BEFORE UPDATE OF `supplier_id`, `purchase_date`, `invoice_number`, `subtotal`, `discount`, `tax`, `total` ON `purchases`
WHEN OLD.`status` <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'A received or cancelled purchase cannot be changed.');
END;
--> statement-breakpoint
CREATE TRIGGER `purchases_no_delete` BEFORE DELETE ON `purchases`
BEGIN
  SELECT RAISE(ABORT, 'A purchase cannot be deleted.');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_lines_locked_insert` BEFORE INSERT ON `purchase_lines`
WHEN (SELECT `status` FROM `purchases` WHERE `id` = NEW.`purchase_id`) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'The items of a received or cancelled purchase cannot be changed.');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_lines_locked_update` BEFORE UPDATE ON `purchase_lines`
WHEN (SELECT `status` FROM `purchases` WHERE `id` = OLD.`purchase_id`) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'The items of a received or cancelled purchase cannot be changed.');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_lines_no_delete` BEFORE DELETE ON `purchase_lines`
BEGIN
  SELECT RAISE(ABORT, 'A purchase line cannot be deleted.');
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payments_only_received` BEFORE INSERT ON `supplier_payments`
WHEN (SELECT `status` FROM `purchases` WHERE `id` = NEW.`purchase_id`) <> 'RECEIVED'
BEGIN
  SELECT RAISE(ABORT, 'Payments can only be recorded against a received purchase.');
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payments_immutable` BEFORE UPDATE OF `purchase_id`, `supplier_id`, `amount`, `method`, `reference`, `notes`, `paid_at`, `recorded_by` ON `supplier_payments`
BEGIN
  SELECT RAISE(ABORT, 'A payment cannot be changed. Void it and record it again.');
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payments_void_once` BEFORE UPDATE OF `voided_at` ON `supplier_payments`
WHEN OLD.`voided_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This payment is already voided.');
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payments_no_delete` BEFORE DELETE ON `supplier_payments`
BEGIN
  SELECT RAISE(ABORT, 'A payment cannot be deleted. Void it instead.');
END;
