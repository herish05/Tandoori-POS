CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`category` text,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reorder_level` integer DEFAULT 0 NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_items_amounts_check" CHECK("inventory_items"."reorder_level" >= 0 and "inventory_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_restaurant_name_unique` ON `inventory_items` (`restaurant_id`,`name`) WHERE "inventory_items"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `recipe_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`menu_item_id` text NOT NULL,
	`variant_id` text,
	`inventory_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `menu_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_lines_quantity_check" CHECK("recipe_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_lines_item_unique` ON `recipe_lines` (`menu_item_id`,`inventory_item_id`) WHERE "recipe_lines"."deleted_at" is null and "recipe_lines"."variant_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_lines_variant_unique` ON `recipe_lines` (`variant_id`,`inventory_item_id`) WHERE "recipe_lines"."deleted_at" is null and "recipe_lines"."variant_id" is not null;--> statement-breakpoint
CREATE INDEX `recipe_lines_ingredient_idx` ON `recipe_lines` (`inventory_item_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`unit_cost` integer,
	`reason` text,
	`order_id` text,
	`order_item_id` text,
	`reverses_movement_id` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverses_movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_movements_quantity_check" CHECK("stock_movements"."quantity" <> 0)
);
--> statement-breakpoint
CREATE INDEX `stock_movements_item_idx` ON `stock_movements` (`inventory_item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_order_item_idx` ON `stock_movements` (`order_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_reverses_unique` ON `stock_movements` (`reverses_movement_id`) WHERE "stock_movements"."reverses_movement_id" is not null;--> statement-breakpoint
CREATE TRIGGER `stock_movements_immutable` BEFORE UPDATE OF `inventory_item_id`, `type`, `quantity`, `balance_after`, `unit_cost`, `reason`, `order_id`, `order_item_id`, `reverses_movement_id`, `created_by` ON `stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'A stock movement cannot be changed. Record a correction instead.');
END;
--> statement-breakpoint
CREATE TRIGGER `stock_movements_no_delete` BEFORE DELETE ON `stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'A stock movement cannot be deleted.');
END;
