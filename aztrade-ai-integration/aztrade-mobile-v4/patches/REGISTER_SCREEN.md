# Integration edits (apply to existing files, do not overwrite them)

## mobile/src/app/(app)/_layout.tsx

Within the existing `<Stack>` containing `(tabs)` and `keyboard`, add:

```tsx
<Stack.Screen name="aztrade" options={{ headerShown: false }} />
```

## mobile/src/app/(app)/(tabs)/account.tsx

After the existing Plan `<Card>` (and before Change password), add:

```tsx
<Card style={{ marginBottom: 14 }}>
  <Text style={{ color: t.ink, fontSize: 17, fontWeight: "700", marginBottom: 8 }}>AZTrade AI</Text>
  <Body muted style={{ marginBottom: 12 }}>Explore market research, practice portfolio, and investment risk. Trading is disabled.</Body>
  <Button title="Open AZTrade AI" variant="outline" onPress={() => router.push("/aztrade")} />
</Card>
```

This preserves the existing six mobile tabs while making AZTrade accessible to signed-in users.

## Required existing A-Zee server endpoints

- `GET /api/aztrade/capabilities` (A-Zee Bearer session)
- `POST /api/aztrade/token` (A-Zee Bearer session) -> `{access_token}`
- `GET /api/aztrade/companion?resource=paper`
- `GET /api/aztrade/companion?resource=risk`
- `GET /api/aztrade/companion?resource=assistant/history`
- `POST /api/aztrade/companion?resource=assistant/chat` -> `{requestId,message}`

The `/companion` endpoint requires BOTH `Authorization: Bearer <A-Zee session>` and `X-AZTrade-Token: Bearer <short-lived AZTrade token>`. Keep the gateway allowlist strict.

Do not use the direct `:4010` backend from the phone. Configure `EXPO_PUBLIC_API_URL` to the reachable A-Zee HTTPS origin; localhost on a physical phone means the phone itself. Do not disable TLS verification.
