       IDENTIFICATION DIVISION.
       PROGRAM-ID. RATES.
      * A batch Db2 program with a table and a text field of its own:
      * a host for the subscript, reference-modification and dynamic
      * SQL seeds.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-RATES.
          05 WS-RATE          PIC 9(3)V99 OCCURS 12.
       01 WS-REGION           PIC X(30).
       01 WS-COUNT            PIC S9(9) COMP.
       PROCEDURE DIVISION.
           EXEC SQL
              SELECT COUNT(*) INTO :WS-COUNT FROM ACCOUNTS
           END-EXEC
           DISPLAY WS-REGION WS-RATE (1) WS-COUNT
           GOBACK.
