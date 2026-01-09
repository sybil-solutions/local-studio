# Exa Search Integration

This project uses [Exa](https://exa.ai) for web search capabilities through the Model Context Protocol (MCP).

## Configuration

### Setting up the Exa API Key

1. Get your API key from [exa.ai](https://exa.ai)

2. Add the MCP server configuration:

```bash
curl -X POST http://localhost:8080/mcp/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "exa",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-exa"],
    "env": {
      "EXA_API_KEY": "your-api-key-here"
    },
    "enabled": true
  }'
```

Or create the MCP config file manually at `~/.config/vllm-studio/mcp_servers.json`:

```json
[
  {
    "name": "exa",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-exa"],
    "env": {
      "EXA_API_KEY": "your-api-key-here"
    },
    "enabled": true
  }
]
```

### Environment Variable (Alternative)

You can also set the `EXA_API_KEY` environment variable before starting the controller:

```bash
export EXA_API_KEY="your-api-key-here"
./start.sh
```

## Usage

Once configured, the Exa search integration will be available in the chat interface. Models with tool calling capabilities can use web search to provide up-to-date information.

### Testing the Integration

```bash
# List available MCP tools
curl http://localhost:8080/mcp/tools

# Test a search (replace with your query)
curl -X POST http://localhost:8080/mcp/tools/exa/exa_search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "latest AI news",
    "numResults": 5
  }'
```

## Security

- **Never commit API keys** to version control
- Add `EXA_API_KEY` to `.gitignore` and `.env` files
- Use environment variables or secure configuration management in production
- Rotate API keys regularly

## Troubleshooting

### MCP Server Not Starting

Check the controller logs:
```bash
tail -f /tmp/controller.log
```

### Tools Not Available

1. Verify the MCP server is configured:
```bash
curl http://localhost:8080/mcp/servers
```

2. Check Node.js is installed (required for npx):
```bash
node --version
npx --version
```

3. Test Exa API key validity:
```bash
curl https://api.exa.ai/search \
  -H "x-api-key: your-api-key-here" \
  -d '{"query": "test", "numResults": 1}'
```

## References

- [Exa Documentation](https://docs.exa.ai)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [vLLM Studio MCP Integration](../README.md)
