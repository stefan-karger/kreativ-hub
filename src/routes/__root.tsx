/// <reference types="vite/client" />

import type { JSXElement } from "solid-js"
import { HydrationScript } from "solid-js/web"

import type { QueryClient } from "@tanstack/solid-query"
import { SolidQueryDevtools } from "@tanstack/solid-query-devtools"
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/solid-router"
import { TanStackRouterDevtools } from "@tanstack/solid-router-devtools"

import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary"
import { NotFound } from "~/components/NotFound"
import appCss from "~/styles/app.css?url"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      {
        charset: "utf-8"
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1"
      }
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png"
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png"
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png"
      },
      { rel: "manifest", href: "/site.webmanifest", color: "#fffff" },
      { rel: "icon", href: "/favicon.ico" }
    ]
  }),
  errorComponent: (props) => {
    return (
      <RootDocument>
        <DefaultCatchBoundary {...props} />
      </RootDocument>
    )
  },
  notFoundComponent: () => <NotFound />,
  component: RootComponent
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: JSXElement }) {
  return (
    <html lang="de">
      <head>
        <HydrationScript />
      </head>
      <body>
        <HeadContent />
        {children}
        <TanStackRouterDevtools position="bottom-right" />
        <SolidQueryDevtools buttonPosition="bottom-left" />
        <Scripts />
      </body>
    </html>
  )
}
