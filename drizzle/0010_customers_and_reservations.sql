CREATE TABLE `customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`customer_id` text NOT NULL,
	`label` text DEFAULT 'Home' NOT NULL,
	`address` text NOT NULL,
	`landmark` text,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customer_addresses_customer_idx` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`notes` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_restaurant_phone_unique` ON `customers` (`restaurant_id`,`phone`) WHERE "customers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`customer_id` text,
	`guest_name` text NOT NULL,
	`guest_phone` text NOT NULL,
	`party_size` integer NOT NULL,
	`reserved_for` integer NOT NULL,
	`duration_minutes` integer DEFAULT 90 NOT NULL,
	`table_id` text,
	`status` text DEFAULT 'BOOKED' NOT NULL,
	`notes` text,
	`seated_at` integer,
	`seated_by` text,
	`cancel_reason` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reservations_party_check" CHECK("reservations"."party_size" between 1 and 50),
	CONSTRAINT "reservations_duration_check" CHECK("reservations"."duration_minutes" between 30 and 360)
);
--> statement-breakpoint
CREATE INDEX `reservations_time_idx` ON `reservations` (`reserved_for`);--> statement-breakpoint
CREATE INDEX `reservations_table_idx` ON `reservations` (`table_id`);--> statement-breakpoint
CREATE INDEX `reservations_customer_idx` ON `reservations` (`customer_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` text REFERENCES customers(id);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE TRIGGER `reservations_status_final` BEFORE UPDATE OF `status` ON `reservations`
WHEN OLD.`status` <> 'BOOKED' AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'A reservation that is seated, cancelled or marked no-show cannot be reopened.');
END;--> statement-breakpoint
CREATE TRIGGER `reservations_no_delete` BEFORE DELETE ON `reservations`
BEGIN
  SELECT RAISE(ABORT, 'A reservation cannot be deleted.');
END;
