CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`station_id` text,
	`is_demo` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_restaurant_name_unique` ON `categories` (`restaurant_id`,`name`) WHERE "categories"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `kitchen_stations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_stations_restaurant_name_unique` ON `kitchen_stations` (`restaurant_id`,`name`) WHERE "kitchen_stations"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `menu_addons` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_addons_price_check" CHECK("menu_addons"."price" >= 0 and ("menu_addons"."kind" <> 'MODIFIER' or "menu_addons"."price" = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_addons_restaurant_name_unique` ON `menu_addons` (`restaurant_id`,`name`) WHERE "menu_addons"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `menu_item_addons` (
	`menu_item_id` text NOT NULL,
	`addon_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`menu_item_id`, `addon_id`),
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`addon_id`) REFERENCES `menu_addons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `menu_item_addons_addon_idx` ON `menu_item_addons` (`addon_id`);--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`food_type` text NOT NULL,
	`image` text,
	`is_available` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_best_seller` integer DEFAULT false NOT NULL,
	`station_id` text,
	`tax_category_id` text,
	`is_demo` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_id`) REFERENCES `tax_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_items_price_check" CHECK("menu_items"."price" >= 0 and "menu_items"."cost_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_category_name_unique` ON `menu_items` (`category_id`,`name`) WHERE "menu_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `menu_items_category_idx` ON `menu_items` (`category_id`);--> statement-breakpoint
CREATE TABLE `menu_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`menu_item_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_available` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_variants_price_check" CHECK("menu_variants"."price" >= 0 and "menu_variants"."cost_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_variants_item_name_unique` ON `menu_variants` (`menu_item_id`,`name`) WHERE "menu_variants"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_variants_item_default_unique` ON `menu_variants` (`menu_item_id`) WHERE "menu_variants"."deleted_at" is null and "menu_variants"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `tax_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`sync_status` text DEFAULT 'PENDING' NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tax_categories_rate_check" CHECK("tax_categories"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_categories_restaurant_name_unique` ON `tax_categories` (`restaurant_id`,`name`) WHERE "tax_categories"."deleted_at" is null;