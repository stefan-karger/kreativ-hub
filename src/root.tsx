// @refresh reload
import "./root.css"
import "@fontsource/inter/latin-400.css"
import "@fontsource/inter/latin-700.css"

import { Suspense } from "solid-js"
import {
  Body,
  ErrorBoundary,
  FileRoutes,
  Head,
  Html,
  Meta,
  Routes,
  Scripts,
  Title,
  Link
} from "solid-start"

import { QueryProvider } from "@prpc/solid"
import { SessionProvider } from "@solid-auth/base/client"
import { QueryClient } from "@tanstack/solid-query"

const queryClient = new QueryClient()

export default function Root() {
  return (
    <Html lang="en">
      <Head>
        <Title>Social CRM</Title>
        <Meta charset="utf-8" />
        <Meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta name="description" content="Generated by create-jd-app" />
        <Link rel="icon" href="/favicon.ico" />
      </Head>
      <Body class="bg-zinc-50">
        <QueryProvider queryClient={queryClient}>
          <SessionProvider>
            <Suspense>
              <ErrorBoundary>
                <Routes>
                  <FileRoutes />
                </Routes>
              </ErrorBoundary>
            </Suspense>
          </SessionProvider>
        </QueryProvider>
        <Scripts />
      </Body>
    </Html>
  )
}
