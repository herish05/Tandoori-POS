CREATE TABLE `day_closings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`closing_number` text NOT NULL,
	`business_date` text NOT NULL,
	`bill_count` integer DEFAULT 0 NOT NULL,
	`sales_total` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	`expected_cash` integer NOT NULL,
	`counted_cash` integer NOT NULL,
	`variance` integer NOT NULL,
	`denominations` text NOT NULL,
	`notes` text,
	`adjustment_entry_id` text,
	`closed_at` integer NOT NULL,
	`closed_by` text NOT NULL,
	`reopened_at` integer,
	`reopened_by` text,
	`reopen_reason` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`adjustment_entry_id`) REFERENCES `cash_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "day_closings_counted_check" CHECK("day_closings"."counted_cash" >= 0),
	CONSTRAINT "day_closings_variance_check" CHECK("day_closings"."variance" = "day_closings"."counted_cash" - "day_closings"."expected_cash")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_closings_restaurant_number_unique` ON `day_closings` (`restaurant_id`,`closing_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `day_closings_standing_unique` ON `day_closings` (`restaurant_id`,`business_date`) WHERE "day_closings"."reopened_at" is null and "day_closings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `day_closings_date_idx` ON `day_closings` (`business_date`);
--> statement-breakpoint
CREATE TRIGGER `day_closings_frozen` BEFORE UPDATE OF `restaurant_id`, `closing_number`, `business_date`, `bill_count`, `sales_total`, `summary`, `expected_cash`, `counted_cash`, `variance`, `denominations`, `notes`, `adjustment_entry_id`, `closed_at`, `closed_by` ON `day_closings`
BEGIN
  SELECT RAISE(ABORT, 'A day closing cannot be changed. Reopen the day and close it again.');
END;
--> statement-breakpoint
CREATE TRIGGER `day_closings_reopen_once` BEFORE UPDATE OF `reopened_at`, `reopened_by`, `reopen_reason` ON `day_closings`
WHEN OLD.`reopened_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This day was already reopened.');
END;
--> statement-breakpoint
CREATE TRIGGER `day_closings_no_delete` BEFORE DELETE ON `day_closings`
BEGIN
  SELECT RAISE(ABORT, 'A day closing cannot be deleted.');
END;
