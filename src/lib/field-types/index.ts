import { FieldRegistry } from './registry';
import { SpreadsheetPlugin } from '@/components/fields/spreadsheet-plugin';
import { EmbedPlugin } from '@/components/fields/embed-plugin';
import { XYChartPlugin } from '@/components/fields/xy-chart-plugin';
import { ChecklistPlugin } from '@/components/fields/checklist-plugin';

// Register plugins
FieldRegistry.register(SpreadsheetPlugin);
FieldRegistry.register(EmbedPlugin);
FieldRegistry.register(XYChartPlugin);
FieldRegistry.register(ChecklistPlugin);

export { FieldRegistry };
