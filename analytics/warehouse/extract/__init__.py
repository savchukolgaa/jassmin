"""The nightly, read-only, pseudonymised copy of the shop's data into ``jassmin_wh`` (#183).

``allowlist`` says what may be read and how each value is changed, ``transforms`` changes it,
``setup`` creates the database, the roles and their grants, and ``extract`` copies the data.
See analytics/warehouse/README.md → Real data.
"""
