export default function ApiIndexPage() {
  return (
    <main>
      <h1>Quest City Web API</h1>
      <p>
        This service is not a browser-facing application. At WEB-M0 it exposes only health
        endpoints:
      </p>
      <ul>
        <li>
          <code>/health/live</code>
        </li>
        <li>
          <code>/health/ready</code>
        </li>
      </ul>
    </main>
  );
}
