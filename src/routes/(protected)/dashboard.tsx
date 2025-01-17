import { createEffect, For } from "solid-js"

import { IconActivity, IconBriefcase, IconMapPin, IconTodo, IconUsers } from "~/components/icons"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { BarChart } from "~/components/ui/charts"
import { useAuth } from "~/hooks/use-auth"
import { timeAgo } from "~/lib/utils"

export default function Dashboard() {
  const user = useAuth()
  // just to show that you how easily you can access the user
  createEffect(() => console.log(user()))

  const data = {
    cards: [
      { title: "Total Clients", icon: IconUsers, value: 1234, text: "+15% from last month" },
      { title: "Active Brands", icon: IconBriefcase, value: 65, text: "+3 new this week" },
      { title: "Locations", icon: IconMapPin, value: 89, text: "Across 12 countries" },
      { title: "Ongoing Projects", icon: IconTodo, value: 32, text: "7 due this week" }
    ],
    chart: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      datasets: [
        {
          label: "2023",
          data: [23, 56, 78, 12, 45, 89, 34, 67, 90, 11, 55, 38],
          backgroundColor: "#2563eb",
          borderRadius: 5
        },
        {
          label: "2024",
          data: [32, 49, 67, 21, 50, 77, 29, 85, 92, 18, 61, 42],
          backgroundColor: "#60a5fa",
          borderRadius: 5
        }
      ]
    },
    activities: [
      { title: "New project started", timestamp: new Date(Date.now() - 300000) }, // 5 minutes ago
      { title: "New location added", timestamp: new Date(Date.now() - 600000) }, // 10 minutes ago
      { title: "New client added", timestamp: new Date(Date.now() - 3600000) }, // 1 hour ago
      { title: "Location removed", timestamp: new Date(Date.now() - 5400000) }, // 1.5 hours ago
      { title: "New location added", timestamp: new Date(Date.now() - 7200000) }, // 2 hours ago
      { title: "Client updated", timestamp: new Date(Date.now() - 10800000) }, // 3 hours ago
      { title: "Client removed", timestamp: new Date(Date.now() - 18000000) }, // 5 hours ago
      { title: "Task finished", timestamp: new Date(Date.now() - 43200000) }, // 12 hours ago
      { title: "Project status updated", timestamp: new Date(Date.now() - 86400000) }, // 1 day ago
      { title: "Project closed", timestamp: new Date(Date.now() - 172800000) } // 2 days ago
    ]
  }

  return (
    <div>
      <div class="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <For each={data.cards}>
          {(card) => (
            <Card>
              <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle class="text-sm font-medium">{card.title}</CardTitle>
                <card.icon class="text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div class="text-2xl font-bold">{card.value}</div>
                <p class="text-xs text-muted-foreground">{card.text}</p>
              </CardContent>
            </Card>
          )}
        </For>
        <Card class="md:col-span-2 lg:col-span-3">
          <CardHeader>
            <CardTitle>Customer Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.chart} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent Activities</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-col gap-4">
            <For each={data.activities}>
              {(activity) => (
                <div class="flex items-center gap-4">
                  <IconActivity class="text-muted-foreground" />
                  <div>
                    <p class="text-sm">{activity.title}</p>
                    <p class="text-xs text-muted-foreground">{timeAgo(activity.timestamp)}</p>
                  </div>
                </div>
              )}
            </For>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
