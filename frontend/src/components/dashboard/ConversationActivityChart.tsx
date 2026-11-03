import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ActivityTooltip } from "./ChartTooltip";
import { formatDayShort, type ActivityDatum } from "./format";

const AXIS_TICK = { fontSize: 12, fill: "#64748B" };

export function ConversationActivityChart({ data, height = 300 }: { data: ActivityDatum[]; height?: number }) {
  const showDots = data.length <= 31;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayShort}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          minTickGap={24}
        />
        <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={ActivityTooltip} cursor={{ stroke: "#CBD5E1", strokeDasharray: "4 4" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Line
          type="monotone"
          dataKey="newConversations"
          name="New conversations"
          stroke="#176B87"
          strokeWidth={2.5}
          dot={showDots ? { r: 2.5, strokeWidth: 0, fill: "#176B87" } : false}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="activeConversations"
          name="Active conversations"
          stroke="#35B6A0"
          strokeWidth={2.5}
          dot={showDots ? { r: 2.5, strokeWidth: 0, fill: "#35B6A0" } : false}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
