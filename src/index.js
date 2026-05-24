@'
import React from "react";
import ReactDOM from "react-dom/client";
import DerivOracle from "./DerivOracle";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<React.StrictMode><DerivOracle /></React.StrictMode>);
'@ | Out-File -FilePath "src\index.js" -Encoding utf8