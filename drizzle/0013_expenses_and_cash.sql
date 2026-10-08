CREATE TABLE `cash_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`notes` text,
	`occurred_at` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_entries_amount_check" CHECK("cash_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `cash_entries_occurred_at_idx` ON `cash_entries` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_restaurant_name_unique` ON `expense_categories` (`restaurant_id`,`name`) WHERE "expense_categories"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`expense_number` text NOT NULL,
	`category_id` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`payee` text,
	`reference` text,
	`notes` text,
	`spent_at` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_amount_check" CHECK("expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_restaurant_number_unique` ON `expenses` (`restaurant_id`,`expense_number`);--> statement-breakpoint
CREATE INDEX `expenses_spent_at_idx` ON `expenses` (`spent_at`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category_id`);
--> statement-breakpoint
CREATE TRIGGER `expenses_identity_immutable` BEFORE UPDATE OF `expense_number`, `recorded_by` ON `expenses`
BEGIN
  SELECT RAISE(ABORT, 'The number and author of an expense cannot be changed.');
END;
--> statement-breakpoint
CREATE TRIGGER `expenses_voided_frozen` BEFORE UPDATE OF `category_id`, `amount`, `method`, `payee`, `reference`, `notes`, `spent_at` ON `expenses`
WHEN OLD.`voided_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A voided expense cannot be changed.');
END;
--> statement-breakpoint
CREATE TRIGGER `expenses_void_once` BEFORE UPDATE OF `voided_at` ON `expenses`
WHEN OLD.`voided_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This expense is already voided.');
END;
--> statement-breakpoint
CREATE TRIGGER `expenses_no_delete` BEFORE DELETE ON `expenses`
BEGIN
  SELECT RAISE(ABORT, 'An expense cannot be deleted. Void it instead.');
END;
--> statement-breakpoint
CREATE TRIGGER `cash_entries_immutable` BEFORE UPDATE OF `kind`, `amount`, `notes`, `occurred_at`, `recorded_by` ON `cash_entries`
BEGIN
  SELECT RAISE(ABORT, 'A cash entry cannot be changed. Void it and record it again.');
END;
--> statement-breakpoint
CREATE TRIGGER `cash_entries_void_once` BEFORE UPDATE OF `voided_at` ON `cash_entries`
WHEN OLD.`voided_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This cash entry is already voided.');
END;
--> statement-breakpoint
CREATE TRIGGER `cash_entries_no_delete` BEFORE DELETE ON `cash_entries`
BEGIN
  SELECT RAISE(ABORT, 'A cash entry cannot be deleted. Void it instead.');
END;
