       IDENTIFICATION DIVISION.
       PROGRAM-ID. POSTING.
      * The same calls with the areas the callees declare, and a table
      * passed to a callee that sizes it by a count.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-LOG-AREA.
          05 WS-LOG-CODE      PIC X(2).
          05 WS-LOG-TEXT      PIC X(38).
          05 WS-LOG-STAMP     PIC X(80).
       01 WS-DATE             PIC X(10).
       01 WS-COUNT            PIC 9(4) COMP VALUE 3.
       01 WS-ITEMS.
          05 WS-ITEM          PIC X(4) OCCURS 3.
       PROCEDURE DIVISION.
           MOVE 'POSTED' TO WS-LOG-TEXT
           CALL 'LOGGER' USING WS-LOG-AREA
           CALL 'DATECHK' USING WS-DATE
           CALL 'ITEMS' USING WS-COUNT WS-ITEMS
           GOBACK.
