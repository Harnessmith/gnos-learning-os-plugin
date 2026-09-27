// Backend request actions shared by GNOS Desktop pages.
// The host-bound rest function and query client are injected at activation time.
export function createApiActions(rest, queryClient) {
  const send = async (path, method, body) => {
    const result = await rest(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : undefined
    })
    await queryClient.invalidateQueries({ queryKey: ['gnos'] })
    return result
  }
  return {
    post: (path, body) => send(path, 'POST', body),
    mutate: (path, method, body) => send(path, method, body)
  }
}
