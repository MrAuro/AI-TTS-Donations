// src/pages/_app.tsx
import {
  ColorScheme,
  ColorSchemeProvider,
  Global,
  MantineProvider,
} from "@mantine/core";
import { withTRPC } from "@trpc/next";
import { SessionProvider } from "next-auth/react";
import type { AppType } from "next/dist/shared/lib/utils";
import { useState } from "react";
import superjson from "superjson";
import type { AppRouter } from "../server/router";

const MyApp: AppType = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  return (
    <MantineTheme>
      <SessionProvider session={session}>
        <Component {...pageProps} />
      </SessionProvider>
    </MantineTheme>
  );
};

const getBaseUrl = () => {
  if (typeof window !== "undefined") {
    return "";
  }
  if (process.browser) return ""; // Browser should use current path
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR should use vercel url

  return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

export default withTRPC<AppRouter>({
  config({ ctx }) {
    /**
     * If you want to use SSR, you need to use the server's full URL
     * @link https://trpc.io/docs/ssr
     */
    const url = `${getBaseUrl()}/api/trpc`;

    return {
      url,
      transformer: superjson,
      /**
       * @link https://react-query.tanstack.com/reference/QueryClient
       */
      // queryClientConfig: { defaultOptions: { queries: { staleTime: 60 } } },
    };
  },
  /**
   * @link https://trpc.io/docs/ssr
   */
  ssr: false,
})(MyApp);

function MantineTheme({ children }: { children: React.ReactNode }) {
  const [colorScheme, setColorScheme] = useState<ColorScheme>("dark");
  const toggleColorScheme = (value?: ColorScheme) =>
    setColorScheme(value || (colorScheme === "dark" ? "light" : "dark"));

  return (
    <ColorSchemeProvider
      colorScheme={colorScheme}
      toggleColorScheme={toggleColorScheme}
    >
      <MantineProvider
        theme={{ colorScheme }}
        withNormalizeCSS
        withGlobalStyles
      >
        <Global
          styles={(theme) => ({
            a: {
              color:
                theme.colorScheme === "dark"
                  ? theme.colors.dark[0]
                  : theme.colors.gray[7],
              textDecoration: "underline",

              "&:hover": {
                backgroundColor:
                  theme.colorScheme === "dark"
                    ? //@ts-ignore
                      theme.fn.rgba(theme.colors[theme.primaryColor][9], 0.25)
                    : //@ts-ignore
                      theme.colors[theme.primaryColor][0],
                color:
                  //@ts-ignore
                  theme.colors[theme.primaryColor][
                    theme.colorScheme === "dark" ? 3 : 7
                  ],
                textDecoration: "none",
              },
            },
          })}
        />
        {children}
      </MantineProvider>
    </ColorSchemeProvider>
  );
}
