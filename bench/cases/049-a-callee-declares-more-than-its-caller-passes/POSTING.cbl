       IDENTIFICATION DIVISION.
       PROGRAM-ID. POSTING.
      * Passes a 40-byte log area to a logger that declares 120 bytes,
      * and the first field of a date group to a validator that takes
      * the whole group.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-LOG-AREA.
          05 WS-LOG-CODE      PIC X(2).
          05 WS-LOG-TEXT      PIC X(38).
       01 WS-DATES.
          05 WS-DATE-YMD      PIC X(8).
          05 WS-DATE-FORMAT   PIC X(10).
       PROCEDURE DIVISION.
           MOVE 'POSTED' TO WS-LOG-TEXT
           CALL 'LOGGER' USING WS-LOG-AREA
           CALL 'DATECHK' USING WS-DATE-YMD
           GOBACK.
