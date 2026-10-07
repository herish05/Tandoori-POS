CREATE TABLE `kot_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`kot_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`item_name` text NOT NULL,
	`variant_name` text,
	`food_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`addons` text NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`cancel_reason` text,
	`cancelled_at` integer,
	FOREIGN KEY (`kot_id`) REFERENCES `kots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kot_items_quantity_check" CHECK("kot_items"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE INDEX `kot_items_kot_idx` ON `kot_items` (`kot_id`);--> statement-breakpoint
CREATE INDEX `kot_items_order_item_idx` ON `kot_items` (`order_item_id`);--> statement-breakpoint
CREATE TABLE `kots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`kot_number` text NOT NULL,
	`order_id` text NOT NULL,
	`station_id` text,
	`station_name` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`is_additional` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`accepted_at` integer,
	`preparing_at` integer,
	`ready_at` integer,
	`served_at` integer,
	`cancel_reason` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`print_count` integer DEFAULT 0 NOT NULL,
	`first_printed_at` integer,
	`last_printed_at` integer,
	`printed_revision` integer DEFAULT 0 NOT NULL,
	`last_print_status` text,
	`last_print_error` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kots_revision_check" CHECK("kots"."revision" >= 0 and "kots"."printed_revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kots_restaurant_number_unique` ON `kots` (`restaurant_id`,`kot_number`);--> statement-breakpoint
CREATE INDEX `kots_order_idx` ON `kots` (`order_id`);--> statement-breakpoint
CREATE INDEX `kots_status_idx` ON `kots` (`status`);--> statement-breakpoint
CREATE INDEX `kots_station_idx` ON `kots` (`station_id`);--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`restaurant_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text,
	`document_number` text,
	`printer_id` text,
	`printer_name` text,
	`status` text NOT NULL,
	`error` text,
	`is_reprint` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`requested_by` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `print_jobs_document_idx` ON `print_jobs` (`document_type`,`document_id`);--> statement-breakpoint
CREATE INDEX `print_jobs_created_idx` ON `print_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`paper_width` integer DEFAULT 80 NOT NULL,
	`station_id` text,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "printers_paper_width_check" CHECK("printers"."paper_width" in (58, 80))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printers_restaurant_name_unique` ON `printers` (`restaurant_id`,`name`) WHERE "printers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `printers_station_unique` ON `printers` (`station_id`) WHERE "printers"."station_id" is not null and "printers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `printers_default_unique` ON `printers` (`restaurant_id`) WHERE "printers"."is_default" = 1 and "printers"."deleted_at" is null;--> statement-breakpoint
CREATE TRIGGER `kots_issued_fields_immutable` BEFORE UPDATE OF `kot_number`, `order_id`, `station_id`, `station_name`, `restaurant_id`, `is_additional`, `created_by` ON `kots`
WHEN NEW.`kot_number` IS NOT OLD.`kot_number` OR NEW.`order_id` IS NOT OLD.`order_id` OR NEW.`station_id` IS NOT OLD.`station_id` OR NEW.`station_name` IS NOT OLD.`station_name` OR NEW.`restaurant_id` IS NOT OLD.`restaurant_id` OR NEW.`is_additional` IS NOT OLD.`is_additional` OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN
  SELECT RAISE(ABORT, 'A kitchen ticket cannot be rewritten once it is issued.');
END;--> statement-breakpoint
CREATE TRIGGER `kots_no_delete` BEFORE DELETE ON `kots`
BEGIN
  SELECT RAISE(ABORT, 'A kitchen ticket cannot be deleted.');
END;--> statement-breakpoint
CREATE TRIGGER `kot_items_issued_fields_immutable` BEFORE UPDATE OF `kot_id`, `order_item_id`, `menu_item_id`, `item_name`, `variant_name`, `food_type`, `quantity`, `addons`, `notes`, `sort_order` ON `kot_items`
WHEN NEW.`kot_id` IS NOT OLD.`kot_id` OR NEW.`order_item_id` IS NOT OLD.`order_item_id` OR NEW.`menu_item_id` IS NOT OLD.`menu_item_id` OR NEW.`item_name` IS NOT OLD.`item_name` OR NEW.`variant_name` IS NOT OLD.`variant_name` OR NEW.`food_type` IS NOT OLD.`food_type` OR NEW.`quantity` IS NOT OLD.`quantity` OR NEW.`addons` IS NOT OLD.`addons` OR NEW.`notes` IS NOT OLD.`notes` OR NEW.`sort_order` IS NOT OLD.`sort_order`
BEGIN
  SELECT RAISE(ABORT, 'A kitchen ticket cannot be rewritten once it is issued.');
END;--> statement-breakpoint
CREATE TRIGGER `kot_items_cancel_is_final` BEFORE UPDATE OF `status` ON `kot_items`
WHEN OLD.`status` = 'CANCELLED' AND NEW.`status` <> 'CANCELLED'
BEGIN
  SELECT RAISE(ABORT, 'A cancelled ticket item cannot be restored.');
END;--> statement-breakpoint
CREATE TRIGGER `kot_items_no_delete` BEFORE DELETE ON `kot_items`
BEGIN
  SELECT RAISE(ABORT, 'A kitchen ticket item cannot be deleted.');
END;
