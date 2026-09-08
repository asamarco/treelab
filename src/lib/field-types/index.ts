import { FieldRegistry } from './registry';
import { SpreadsheetPlugin } from '@/components/fields/spreadsheet-plugin';
import { EmbedPlugin } from '@/components/fields/embed-plugin';
import { XYChartPlugin } from '@/components/fields/xy-chart-plugin';
import { ChecklistPlugin } from '@/components/fields/checklist-plugin';
import { PicturePlugin } from '@/components/fields/picture-plugin';
import { AttachmentPlugin } from '@/components/fields/attachment-plugin';

// Register plugins
FieldRegistry.register(SpreadsheetPlugin);
FieldRegistry.register(EmbedPlugin);
FieldRegistry.register(XYChartPlugin);
FieldRegistry.register(ChecklistPlugin);
FieldRegistry.register(PicturePlugin);
FieldRegistry.register(AttachmentPlugin);

export { FieldRegistry };

