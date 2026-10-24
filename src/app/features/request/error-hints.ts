/** Título e sugestões exibidos quando a requisição falha, conforme o código do erro. */
export interface ErrorHelp {
    title: string;
    hints: string[];
}

const CERTIFICATE_HELP: ErrorHelp = {
    title: 'Certificate error',
    hints: ['The server certificate could not be verified (self-signed, expired or issued by an unknown authority).', 'Add the CA certificate in Preferences → Certificates, or turn off certificate verification there (only for trusted servers).']
};

const TIMEOUT_HELP: ErrorHelp = {
    title: 'Request timed out',
    hints: ['The server took too long to respond. Check that it is not stuck or overloaded.', 'Increase the request timeout in Preferences → General (0 disables it).']
};

const HELP: Record<string, ErrorHelp> = {
    ECONNREFUSED: {
        title: 'Connection refused',
        hints: [
            'Nothing is accepting connections on this host and port. Check that the server is running.',
            'Confirm the host and port in the URL (and in variables such as {{$.baseUrl}}).',
            'If you use a proxy, check its address in Preferences → Proxy.'
        ]
    },
    ENOTFOUND: {
        title: 'Host not found',
        hints: ['The host name could not be resolved (DNS). Check the URL for typos.', 'Check your network connection, VPN and the proxy settings in Preferences → Proxy.']
    },
    EAI_AGAIN: {
        title: 'DNS lookup failed',
        hints: ['The DNS server did not answer in time. Check your network connection or VPN and try again.']
    },
    ECONNRESET: {
        title: 'Connection reset',
        hints: ['The server or a proxy closed the connection unexpectedly.', 'Check whether the server expects https:// instead of http:// (or the other way around).']
    },
    UND_ERR_SOCKET: {
        title: 'Connection closed',
        hints: ['The connection was closed before the response finished.', 'Check whether the server expects https:// instead of http:// (or the other way around).']
    },
    EHOSTUNREACH: {
        title: 'Host unreachable',
        hints: ['There is no network route to the host. Check your network connection, VPN or firewall.']
    },
    ENETUNREACH: {
        title: 'Network unreachable',
        hints: ['There is no network route to the host. Check your network connection, VPN or firewall.']
    },
    EPROTO: {
        title: 'TLS handshake failed',
        hints: ['The secure connection could not be negotiated. Check whether the server really uses https:// on this port.']
    },
    TIMEOUT: TIMEOUT_HELP,
    ETIMEDOUT: TIMEOUT_HELP,
    UND_ERR_CONNECT_TIMEOUT: TIMEOUT_HELP,
    UND_ERR_HEADERS_TIMEOUT: TIMEOUT_HELP,
    UND_ERR_BODY_TIMEOUT: TIMEOUT_HELP,
    CANCELLED: {
        title: 'Request cancelled',
        hints: ['The request was cancelled before a response arrived. Send it again when ready.']
    },
    UNSUPPORTED_PROTOCOL: {
        title: 'Unsupported protocol',
        hints: ['Only http:// and https:// URLs are supported. Check the beginning of the URL for typos.', 'If the URL starts with a variable (such as {{$.baseUrl}}), check its value in the selected environment.']
    },
    ERR_INVALID_URL: {
        title: 'Invalid URL',
        hints: ['The URL is not valid. It must be complete, like https://api.example.com/users.', 'If the URL uses variables, check that they resolve to a complete URL in the selected environment.']
    },
    UNRESOLVED_VARIABLES: {
        title: 'Undefined variables',
        hints: ['Define the variables in Environments or in the collection Variables tab, or select the environment that has them in the top bar.']
    },
    TEMPLATE_ERROR: {
        title: 'Invalid variable or command',
        hints: ['Fix the highlighted (red) chips in the request: hover them to see the reason.', 'A referenced request without a response is sent automatically unless it uses { send: \'never\' }.']
    },
    SCRIPT_ERROR: {
        title: 'Pre-request script failed',
        hints: ['Fix the error in the Pre-request tab; the request was not sent.', 'Messages written with console.log appear in the Console tab.']
    },
    MISSING_URL: {
        title: 'Missing URL',
        hints: ['Type the address of the request in the URL field, then send it again.']
    },
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: CERTIFICATE_HELP,
    UNABLE_TO_GET_ISSUER_CERT: CERTIFICATE_HELP,
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: CERTIFICATE_HELP,
    SELF_SIGNED_CERT_IN_CHAIN: CERTIFICATE_HELP,
    DEPTH_ZERO_SELF_SIGNED_CERT: CERTIFICATE_HELP,
    CERT_HAS_EXPIRED: CERTIFICATE_HELP,
    CERT_NOT_YET_VALID: CERTIFICATE_HELP,
    ERR_TLS_CERT_ALTNAME_INVALID: CERTIFICATE_HELP
};

const FALLBACK: ErrorHelp = {
    title: 'Could not send the request',
    hints: ['Check the URL, your network connection and the proxy settings in Preferences → Proxy.', 'Open the Console tab to see each step of the request.']
};

export const errorHelp = (code: string | undefined): ErrorHelp => (code && HELP[code]) || FALLBACK;
