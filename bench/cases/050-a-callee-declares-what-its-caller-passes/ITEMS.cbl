       IDENTIFICATION DIVISION.
       PROGRAM-ID. ITEMS.
       DATA DIVISION.
       LINKAGE SECTION.
       01 LK-COUNT            PIC 9(4) COMP.
       01 LK-ITEMS.
          05 LK-ITEM          PIC X(4) OCCURS 1 TO 50
                              DEPENDING ON LK-COUNT.
       PROCEDURE DIVISION USING LK-COUNT LK-ITEMS.
           GOBACK.
