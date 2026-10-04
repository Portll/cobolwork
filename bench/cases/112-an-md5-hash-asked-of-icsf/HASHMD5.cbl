       IDENTIFICATION DIVISION.
       PROGRAM-ID. HASHMD5.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  RC          PIC 9(8) COMP.
       01  RS          PIC 9(8) COMP.
       01  EXL         PIC 9(8) COMP VALUE 0.
       01  EXD         PIC X(4).
       01  RULES       PIC X(16) VALUE 'MD5     ONLY'.
       01  RCNT        PIC 9(8) COMP VALUE 2.
       01  TLEN        PIC 9(8) COMP.
       01  TXT         PIC X(100).
       01  CVL         PIC 9(8) COMP.
       01  CV          PIC X(128).
       01  HLEN        PIC 9(8) COMP.
       01  HASH        PIC X(64).
       PROCEDURE DIVISION.
           CALL 'CSNBOWH' USING RC RS EXL EXD RCNT RULES
               TLEN TXT CVL CV HLEN HASH.
           GOBACK.
