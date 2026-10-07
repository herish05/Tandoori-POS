CREATE TABLE `refund_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refund_lines_amount_check" CHECK("refund_lines"."amount" >= 1)
);
--> statement-breakpoint
CREATE INDEX `refund_lines_refund_idx` ON `refund_lines` (`refund_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`refund_number` text NOT NULL,
	`bill_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`refunded_by` text NOT NULL,
	`refunded_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refunded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refunds_amount_check" CHECK("refunds"."amount" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_restaurant_number_unique` ON `refunds` (`restaurant_id`,`refund_number`);--> statement-breakpoint
CREATE INDEX `refunds_bill_idx` ON `refunds` (`bill_id`);--> statement-breakpoint
CREATE INDEX `refunds_refunded_at_idx` ON `refunds` (`refunded_at`);--> statement-breakpoint
ALTER TABLE `print_jobs` ADD `snapshot` text;--> statement-breakpoint
ALTER TABLE `billing_settings` ADD `auto_print_receipt` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `refunded_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP TRIGGER `bills_status_is_final`;--> statement-breakpoint
CREATE TRIGGER `bills_status_is_final` BEFORE UPDATE OF `status` ON `bills`
WHEN (OLD.`status` = 'CANCELLED' AND NEW.`status` <> 'CANCELLED') OR (OLD.`status` = 'REFUNDED' AND NEW.`status` <> 'REFUNDED') OR (OLD.`status` = 'PAID' AND NEW.`status` IN ('PENDING', 'PARTIAL', 'CANCELLED')) OR (OLD.`status` = 'PARTIAL' AND NEW.`status` = 'PENDING')
BEGIN
  SELECT RAISE(ABORT, 'That change of bill status is not allowed.');
END;--> statement-breakpoint
CREATE TRIGGER `bills_refunded_total_range` BEFORE UPDATE OF `refunded_total`, `paid_total` ON `bills`
WHEN NEW.`refunded_total` < OLD.`refunded_total` OR NEW.`refunded_total` < 0 OR NEW.`refunded_total` > NEW.`paid_total`
BEGIN
  SELECT RAISE(ABORT, 'A refund cannot be more than what was paid, and cannot be taken back.');
END;--> statement-breakpoint
CREATE TRIGGER `refunds_only_on_paid_bills` BEFORE INSERT ON `refunds`
WHEN (SELECT `status` FROM `bills` WHERE `id` = NEW.`bill_id`) NOT IN ('PARTIAL', 'PAID')
BEGIN
  SELECT RAISE(ABORT, 'Only a bill that has taken payment can be refunded.');
END;--> statement-breakpoint
CREATE TRIGGER `refunds_immutable` BEFORE UPDATE OF `restaurant_id`, `refund_number`, `bill_id`, `amount`, `reason`, `refunded_by`, `refunded_at` ON `refunds`
WHEN NEW.`restaurant_id` IS NOT OLD.`restaurant_id` OR NEW.`refund_number` IS NOT OLD.`refund_number` OR NEW.`bill_id` IS NOT OLD.`bill_id` OR NEW.`amount` IS NOT OLD.`amount` OR NEW.`reason` IS NOT OLD.`reason` OR NEW.`refunded_by` IS NOT OLD.`refunded_by` OR NEW.`refunded_at` IS NOT OLD.`refunded_at`
BEGIN
  SELECT RAISE(ABORT, 'A refund cannot be changed once it is recorded.');
END;--> statement-breakpoint
CREATE TRIGGER `refunds_no_delete` BEFORE DELETE ON `refunds`
BEGIN
  SELECT RAISE(ABORT, 'A refund cannot be deleted.');
END;--> statement-breakpoint
CREATE TRIGGER `refund_lines_immutable` BEFORE UPDATE ON `refund_lines`
BEGIN
  SELECT RAISE(ABORT, 'A refund cannot be changed once it is recorded.');
END;--> statement-breakpoint
CREATE TRIGGER `refund_lines_no_delete` BEFORE DELETE ON `refund_lines`
BEGIN
  SELECT RAISE(ABORT, 'A refund cannot be deleted.');
END;
