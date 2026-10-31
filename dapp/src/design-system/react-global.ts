import React from "react";

// The design-system bundle is a classic script that reads React from window, as on the DS preview pages.
(window as unknown as { React: typeof React }).React = React;
