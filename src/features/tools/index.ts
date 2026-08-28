import { registry } from "./registry";
import { echoTool } from "./tools/echo";
import { scheduleLinkTool } from "./tools/schedule-link";
import { scheduleHighLevelTool } from "./tools/schedule-highlevel";
import { checkAvailabilityTool } from "./tools/check-availability";
import { customWebhookTool } from "./tools/custom-webhook";
import { calcomCheckAvailabilityTool } from "./tools/calcom-check-availability";
import { calcomBookTool } from "./tools/calcom-book";
import { calcomRescheduleTool } from "./tools/calcom-reschedule";
import { calcomCancelTool } from "./tools/calcom-cancel";

registry.register(echoTool);
registry.register(scheduleLinkTool);
registry.register(scheduleHighLevelTool);
registry.register(checkAvailabilityTool);
registry.register(customWebhookTool);
registry.register(calcomCheckAvailabilityTool);
registry.register(calcomBookTool);
registry.register(calcomRescheduleTool);
registry.register(calcomCancelTool);

export { registry };
export type {
  Tool,
  ToolContext,
  ToolResult,
  ToolSensitivity,
} from "./core/tool";
