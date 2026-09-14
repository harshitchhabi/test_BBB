ALTER TABLE "recipe_requirements" DROP CONSTRAINT "recipe_requirements_material_type_id_material_types_id_fk";
--> statement-breakpoint
ALTER TABLE "city_preferences" DROP CONSTRAINT "city_preferences_building_recipe_id_building_recipes_id_fk";
--> statement-breakpoint
ALTER TABLE "event_settings" ADD COLUMN "custom_rules_note" text;--> statement-breakpoint
ALTER TABLE "recipe_requirements" ADD CONSTRAINT "recipe_requirements_material_type_id_material_types_id_fk" FOREIGN KEY ("material_type_id") REFERENCES "public"."material_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_preferences" ADD CONSTRAINT "city_preferences_building_recipe_id_building_recipes_id_fk" FOREIGN KEY ("building_recipe_id") REFERENCES "public"."building_recipes"("id") ON DELETE cascade ON UPDATE no action;