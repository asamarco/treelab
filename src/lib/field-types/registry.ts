import { UseFormReturn } from "react-hook-form";
import { Field, FieldType, TreeNode } from "@/lib/types";

export interface FieldTypePlugin {
    type: FieldType;
    label: string;
    icon: React.ElementType; // e.g., Grid3X3 from lucide-react

    // Renders extra settings in template-designer
    DesignerSettings?: React.ComponentType<{ form: UseFormReturn<any>, index: number, fieldId: string }>;

    // Renders the data editor in node-form
    EditorComponent?: React.ComponentType<{
        field: Field;
        value: any;
        onChange: (val: any) => void;
        readOnly?: boolean;
    }>;

    // Renders the read-only presentation in tree-node-content
    ViewerComponent?: React.ComponentType<{
        field: Field;
        value: any;
        node?: TreeNode;
        readOnly?: boolean;
        isCompactView?: boolean;
    }>;

    // Optional lifecycle hook to sanitize/transform form data before saving
    sanitizeOnSave?: (value: any) => any;
}

class Registry {
    private plugins = new Map<FieldType, FieldTypePlugin>();

    register(plugin: FieldTypePlugin) {
        this.plugins.set(plugin.type, plugin);
    }

    get(type: FieldType): FieldTypePlugin | undefined {
        return this.plugins.get(type);
    }

    getAll(): FieldTypePlugin[] {
        return Array.from(this.plugins.values());
    }
}

export const FieldRegistry = new Registry();
