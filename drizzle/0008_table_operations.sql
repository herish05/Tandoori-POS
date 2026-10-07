CREATE TABLE `table_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`kind` text NOT NULL,
	`order_id` text NOT NULL,
	`source_order_id` text,
	`from_table_id` text NOT NULL,
	`to_table_id` text NOT NULL,
	`moved_lines` integer DEFAULT 0 NOT NULL,
	`moved_tickets` integer DEFAULT 0 NOT NULL,
	`performed_by` text NOT NULL,
	`performed_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "table_operations_kind_check" CHECK(("table_operations"."kind" = 'MERGE') = ("table_operations"."source_order_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `table_operations_order_idx` ON `table_operations` (`order_id`);--> statement-breakpoint
CREATE INDEX `table_operations_source_idx` ON `table_operations` (`source_order_id`);--> statement-breakpoint
CREATE TRIGGER `table_operations_immutable` BEFORE UPDATE OF `restaurant_id`, `kind`, `order_id`, `source_order_id`, `from_table_id`, `to_table_id`, `moved_lines`, `moved_tickets`, `performed_by`, `performed_at` ON `table_operations`
WHEN NEW.`restaurant_id` IS NOT OLD.`restaurant_id` OR NEW.`kind` IS NOT OLD.`kind` OR NEW.`order_id` IS NOT OLD.`order_id` OR NEW.`source_order_id` IS NOT OLD.`source_order_id` OR NEW.`from_table_id` IS NOT OLD.`from_table_id` OR NEW.`to_table_id` IS NOT OLD.`to_table_id` OR NEW.`moved_lines` IS NOT OLD.`moved_lines` OR NEW.`moved_tickets` IS NOT OLD.`moved_tickets` OR NEW.`performed_by` IS NOT OLD.`performed_by` OR NEW.`performed_at` IS NOT OLD.`performed_at`
BEGIN
  SELECT RAISE(ABORT, 'A table operation cannot be changed once it is recorded.');
END;--> statement-breakpoint
CREATE TRIGGER `table_operations_no_delete` BEFORE DELETE ON `table_operations`
BEGIN
  SELECT RAISE(ABORT, 'A table operation cannot be deleted.');
END;--> statement-breakpoint
DROP TRIGGER `kots_issued_fields_immutable`;--> statement-breakpoint
CREATE TRIGGER `kots_issued_fields_immutable` BEFORE UPDATE OF `kot_number`, `order_id`, `station_id`, `station_name`, `restaurant_id`, `is_additional`, `created_by` ON `kots`
WHEN NEW.`kot_number` IS NOT OLD.`kot_number` OR NEW.`station_id` IS NOT OLD.`station_id` OR NEW.`station_name` IS NOT OLD.`station_name` OR NEW.`restaurant_id` IS NOT OLD.`restaurant_id` OR NEW.`is_additional` IS NOT OLD.`is_additional` OR NEW.`created_by` IS NOT OLD.`created_by` OR (NEW.`order_id` IS NOT OLD.`order_id` AND NOT EXISTS (SELECT 1 FROM `table_operations` WHERE `kind` = 'MERGE' AND `source_order_id` = OLD.`order_id` AND `order_id` = NEW.`order_id`))
BEGIN
  SELECT RAISE(ABORT, 'A kitchen ticket cannot be rewritten once it is issued.');
END;
